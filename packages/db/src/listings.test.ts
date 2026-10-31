import { randomUUID } from "node:crypto";
import { haversineKm, isWithinBounds } from "@nevile/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "./client.ts";
import { importPostalAreas, parseCsv, readAreasCsv } from "./import-postal-areas.ts";
import {
  addresses,
  arrivalWindows,
  availabilityRules,
  bookingCheckouts,
  businesses,
  businessMembers,
  businessPhotos,
  postalAreas,
  serviceAreas,
  serviceCategories,
  services,
  user,
} from "./schema/index.ts";
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

  describe("booking setup (SPEC §19)", () => {
    it("keeps arrival windows between 6 am and 9 pm, 1–6 hours, on 15-minute marks", async () => {
      await db.insert(arrivalWindows).values({ businessId, startMinute: 480, endMinute: 660 });
      expect(
        await violation(
          db.insert(arrivalWindows).values({ businessId, startMinute: 480, endMinute: 600 }),
        ),
      ).toMatchObject({ code: "23505", constraint: "arrival_windows_business_start_uidx" });
      for (const [startMinute, endMinute, constraint] of [
        [300, 480, "arrival_windows_range"],
        [600, 630, "arrival_windows_range"],
        [600, 1000, "arrival_windows_range"],
        [605, 785, "arrival_windows_step"],
      ] as const) {
        expect(
          await violation(db.insert(arrivalWindows).values({ businessId, startMinute, endMinute })),
        ).toMatchObject({ code: "23514", constraint });
      }
    });

    it("bounds how soon and how far ahead customers can book", async () => {
      for (const set of [
        { minNoticeDays: 15 },
        { maxDaysAhead: 181 },
        { minNoticeDays: 7, maxDaysAhead: 7 },
      ]) {
        expect(
          await violation(db.update(businesses).set(set).where(eq(businesses.id, businessId))),
        ).toMatchObject({ code: "23514", constraint: "businesses_booking_notice" });
      }
    });

    it("allows one span of working hours per crew member and weekday", async () => {
      const [owner] = await db
        .select({ id: businesses.ownerUserId })
        .from(businesses)
        .where(eq(businesses.id, businessId));
      const [member] = await db
        .insert(businessMembers)
        .values({ businessId, userId: owner?.id ?? "", role: "owner" })
        .returning({ id: businessMembers.id });
      const memberId = member?.id ?? "";
      await db
        .insert(availabilityRules)
        .values({ memberId, weekday: 1, startMinute: 480, endMinute: 1020 });
      expect(
        await violation(
          db
            .insert(availabilityRules)
            .values({ memberId, weekday: 1, startMinute: 1080, endMinute: 1200 }),
        ),
      ).toMatchObject({ code: "23505", constraint: "availability_rules_member_weekday_uidx" });
    });

    it("keeps checkout totals consistent and links each to at most one booking", async () => {
      const [customer] = await db
        .insert(user)
        .values({ id: randomUUID(), name: "Cam Customer", email: "cam@example.com" })
        .returning({ id: user.id });
      const [category] = await db
        .insert(serviceCategories)
        .values({ slug: "lawn-mowing", name: "Lawn Mowing" })
        .onConflictDoNothing()
        .returning({ id: serviceCategories.id });
      const [service] = await db
        .insert(services)
        .values({
          businessId,
          categoryId: category?.id ?? "",
          title: "Mowing",
          pricingType: "fixed",
          priceCents: 6000,
          durationMinutes: 60,
        })
        .returning({ id: services.id });
      const [address] = await db
        .insert(addresses)
        .values({
          userId: customer?.id ?? "",
          line1: "1 Test Road",
          city: "Halifax",
          province: "NS",
          postalCode: "B3H 1A1",
        })
        .returning({ id: addresses.id });
      const checkout = {
        customerId: customer?.id ?? "",
        businessId,
        serviceId: service?.id ?? "",
        addressId: address?.id ?? "",
        title: "Weekly mowing",
        startsAt: new Date("2026-11-02T12:00:00Z"),
        endsAt: new Date("2026-11-02T15:00:00Z"),
        workMinutes: 60,
        instantBook: true,
        priceCents: 6000,
        serviceFeeCents: 422,
        priceTaxCents: 840,
        feeTaxCents: 59,
        totalCents: 7321,
        businessFeeCents: 180,
        taxProvince: "NS" as const,
        cancellationPolicy: "flexible" as const,
        provider: "fake" as const,
        expiresAt: new Date("2026-11-01T12:30:00Z"),
      };
      await expect(db.insert(bookingCheckouts).values(checkout)).resolves.toBeDefined();
      expect(
        await violation(db.insert(bookingCheckouts).values({ ...checkout, totalCents: 7320 })),
      ).toMatchObject({ code: "23514", constraint: "booking_checkouts_total_is_sum" });
      expect(
        await violation(db.insert(bookingCheckouts).values({ ...checkout, status: "completed" })),
      ).toMatchObject({ code: "23514", constraint: "booking_checkouts_completed_fields" });
    });
  });
});
