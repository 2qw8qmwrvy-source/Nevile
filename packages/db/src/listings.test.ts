import { randomUUID } from "node:crypto";
import { haversineKm, isWithinBounds } from "@nevile/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "./client.ts";
import { importPostalAreas, parseCsv, readAreasCsv } from "./import-postal-areas.ts";
import { businesses, businessPhotos, postalAreas, serviceAreas, user } from "./schema/index.ts";
import { seedPostalAreas, starterPostalAreas } from "./seed.ts";
import { resetTestDatabase } from "./testing.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** The Postgres error code and constraint a query raised, or null if it succeeded. */
async function violation(query: PromiseLike<unknown>) {
  try {
    await query;
    return null;
  } catch (error) {
    let current: unknown = error;
    while (current && typeof current === "object") {
      if ("code" in current && typeof current.code === "string") {
        const constraint = "constraint" in current ? current.constraint : undefined;
        return { code: current.code, constraint };
      }
      current = "cause" in current ? current.cause : undefined;
    }
    throw error;
  }
}

describe("starter postal areas", () => {
  const starter = starterPostalAreas();

  it("are Nova Scotia areas inside Nova Scotia, flagged as starter data", () => {
    expect(starter.province).toBe("NS");
    expect(starter.source).toMatch(/approximate/i);
    const codes = new Set<string>();
    for (const area of starter.areas) {
      expect(area.code, area.code).toMatch(/^B\d[A-Z]$/);
      expect(codes.has(area.code), `duplicate ${area.code}`).toBe(false);
      codes.add(area.code);
      expect(isWithinBounds(area), area.code).toBe(true);
      expect(area.placeName.trim(), area.code).not.toBe("");
    }
    // The core of Halifax, Dartmouth, Bedford and Sackville is covered.
    for (const code of ["B3H", "B3J", "B2Y", "B4A", "B4C"]) expect(codes.has(code)).toBe(true);
  });

  it("place Halifax and Dartmouth areas a few km apart", () => {
    const find = (code: string) => starter.areas.find((area) => area.code === code);
    const halifax = find("B3H");
    const dartmouth = find("B2Y");
    if (!halifax || !dartmouth) throw new Error("missing fixture areas");
    expect(haversineKm(halifax, dartmouth)).toBeLessThan(6);
  });
});

describe("postal area CSV import", () => {
  it("parses quoted fields, doubled quotes, CRLF and a byte-order mark", () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n')).toEqual([
      ["a", "b, c", 'd "e"'],
      ["1", "2", "3"],
    ]);
    const areas = readAreasCsv('﻿code,place_name,lat,lng\nb3h,"Halifax, South End",44.63,-63.58\n');
    expect(areas).toEqual([
      { code: "B3H", placeName: "Halifax, South End", lat: 44.63, lng: -63.58, province: "NS" },
    ]);
  });

  it("rejects bad rows with the line number", () => {
    expect(() => readAreasCsv("code,place_name,lat,lng\nZZZ,X,1,1\n")).toThrow(/Line 2/);
    expect(() => readAreasCsv("code,place_name,lat,lng\nB3H,,1,1\n")).toThrow(/place_name/);
    expect(() => readAreasCsv("code,place_name,lat,lng\nB3H,X,95,1\n")).toThrow(/lat/);
    expect(() => readAreasCsv("code,place,lat,lng\n")).toThrow(/place_name/);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("listing tables", () => {
  let db: Database;
  let businessId = "";

  beforeAll(async () => {
    const url = TEST_DATABASE_URL as string;
    await resetTestDatabase(url);
    db = createDb(url, { max: 2 });
    const [owner] = await db
      .insert(user)
      .values({ id: randomUUID(), name: "Lee Lister", email: "lee@example.com" })
      .returning({ id: user.id });
    const [business] = await db
      .insert(businesses)
      .values({
        ownerUserId: owner?.id ?? "",
        name: "Harbour Lawns",
        slug: "harbour-lawns",
        province: "NS",
      })
      .returning({ id: businesses.id });
    businessId = business?.id ?? "";
  });

  afterAll(async () => {
    await db?.$client.end();
  });

  it("seeds starter areas once and never overwrites imported data", async () => {
    const starter = starterPostalAreas();
    expect(await seedPostalAreas(db)).toBe(starter.areas.length);
    expect(await seedPostalAreas(db)).toBe(0);

    await importPostalAreas(
      db,
      [{ code: "B3H", placeName: "Halifax (official)", lat: 44.635, lng: -63.586, province: "NS" }],
      "Statistics Canada FSA boundary file (test)",
    );
    const [imported] = await db.select().from(postalAreas).where(eq(postalAreas.code, "B3H"));
    expect(imported).toMatchObject({ placeName: "Halifax (official)", approximate: false });

    // Re-seeding leaves the imported row alone.
    await seedPostalAreas(db);
    const [after] = await db.select().from(postalAreas).where(eq(postalAreas.code, "B3H"));
    expect(after?.placeName).toBe("Halifax (official)");
  });

  it("rejects malformed postal area codes", async () => {
    expect(
      await violation(
        db.insert(postalAreas).values({
          code: "B3",
          province: "NS",
          placeName: "Nowhere",
          lat: 44,
          lng: -63,
          source: "test",
        }),
      ),
    ).toMatchObject({ code: "23514", constraint: "postal_areas_code_format" });
  });

  it("allows one service area per business", async () => {
    await db.insert(serviceAreas).values({ businessId, lat: 44.73, lng: -63.65, radiusKm: 25 });
    expect(
      await violation(
        db.insert(serviceAreas).values({ businessId, lat: 44.64, lng: -63.58, radiusKm: 10 }),
      ),
    ).toMatchObject({ code: "23505", constraint: "service_areas_business_id_uidx" });
    expect(
      await violation(
        db
          .update(serviceAreas)
          .set({ radiusKm: 101 })
          .where(eq(serviceAreas.businessId, businessId)),
      ),
    ).toMatchObject({ code: "23514", constraint: "service_areas_radius_km_range" });
  });

  it("stores photos with sane dimensions and unique keys, and deletes them with the business", async () => {
    await db
      .insert(businessPhotos)
      .values({ businessId, storageKey: "businesses/x/photos/a.webp", width: 1600, height: 1200 });
    expect(
      await violation(
        db
          .insert(businessPhotos)
          .values({ businessId, storageKey: "businesses/x/photos/a.webp", width: 10, height: 10 }),
      ),
    ).toMatchObject({ code: "23505" });
    expect(
      await violation(
        db
          .insert(businessPhotos)
          .values({ businessId, storageKey: "businesses/x/photos/b.webp", width: 0, height: 10 }),
      ),
    ).toMatchObject({ code: "23514", constraint: "business_photos_dimensions" });
    expect(
      await violation(
        db.insert(businessPhotos).values({
          businessId,
          storageKey: "businesses/x/photos/c.webp",
          width: 10,
          height: 10,
          altText: "x".repeat(161),
        }),
      ),
    ).toMatchObject({ code: "23514", constraint: "business_photos_alt_text_length" });
  });

  it("keeps logo keys unique across businesses", async () => {
    await db
      .update(businesses)
      .set({ logoKey: "logos/one.webp" })
      .where(eq(businesses.id, businessId));
    const [owner] = await db
      .insert(user)
      .values({ id: randomUUID(), name: "Second Owner", email: "second@example.com" })
      .returning({ id: user.id });
    expect(
      await violation(
        db.insert(businesses).values({
          ownerUserId: owner?.id ?? "",
          name: "Copycat",
          slug: "copycat",
          province: "NS",
          logoKey: "logos/one.webp",
        }),
      ),
    ).toMatchObject({ code: "23505" });
  });
});
