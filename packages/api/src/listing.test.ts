import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LatLng, ServiceInput } from "@nevile/core";
import {
  addresses,
  bookings,
  businesses,
  businessMembers,
  businessPhotos,
  eq,
  reviews,
  serviceAreas,
  services,
  visits,
} from "@nevile/db";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Context } from "./context.ts";
import { saveBusinessImage } from "./media.ts";
import { createCaller } from "./root.ts";
import { createHarness, type Harness, trpcError } from "./test/harness.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const ABOUT = "Family-run lawn and snow crew serving Bedford and Sackville since 2012.";
const BEDFORD: LatLng = { lat: 44.7316, lng: -63.6545 };
const SYDNEY: LatLng = { lat: 46.1368, lng: -60.1942 };
const DARTMOUTH: LatLng = { lat: 44.6652, lng: -63.5677 };
const TORONTO: LatLng = { lat: 43.6532, lng: -79.3832 };

const mowing: ServiceInput = {
  categorySlug: "lawn-mowing",
  title: "Weekly mowing",
  description: "Mow, trim and blow off the walks.",
  pricingType: "fixed",
  priceCents: 6000,
  fromPriceCents: null,
  durationMinutes: 60,
  instantBook: true,
  active: true,
};
const snowQuote: ServiceInput = {
  categorySlug: "snow-ice-removal",
  title: "Driveway clearing",
  description: "",
  pricingType: "quote",
  priceCents: null,
  fromPriceCents: 4500,
  durationMinutes: 45,
  instantBook: false,
  active: true,
};
const cleaning: ServiceInput = {
  ...mowing,
  categorySlug: "house-cleaning",
  title: "Standard clean",
  priceCents: 12000,
};

async function jpeg(width = 640, height = 480): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: "#4a7" } })
      .jpeg()
      .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "44/1 43/1 0/1" } })
      .toBuffer(),
  );
}

describe.skipIf(!TEST_DATABASE_URL)("listings and search", () => {
  let harness: Harness;
  let owner: Context;
  let manager: Context;
  let crew: Context;
  let outsider: Context;
  let businessId: string;
  let slug: string;
  let emailCounter = 0;

  const call = (ctx: Context) => createCaller(ctx);

  async function addMember(userId: string, id: string, role: "manager" | "crew") {
    await harness.db.insert(businessMembers).values({ businessId: id, userId, role });
  }

  type ListOptions = {
    center: LatLng;
    radiusKm: number;
    services: ServiceInput[];
    instantBook?: boolean;
    pro?: boolean;
    verified?: boolean;
    publish?: boolean;
  };

  /** Signs up an owner and lists a business with `options`; returns its id and slug. */
  async function listBusiness(name: string, options: ListOptions) {
    emailCounter += 1;
    const person = await harness.signUp(
      `owner${emailCounter}@example.com`,
      `Owner ${emailCounter}`,
    );
    const api = call(person.ctx);
    const created = await api.business.create({ name, province: "NS" });
    await api.listing.updateProfile({
      businessId: created.id,
      name,
      description: ABOUT,
      gstHstNumber: "",
      cancellationPolicy: "moderate",
      instantBook: options.instantBook ?? false,
    });
    await api.listing.setServiceArea({
      businessId: created.id,
      center: options.center,
      radiusKm: options.radiusKm,
    });
    for (const service of options.services) {
      await api.listing.createService({ businessId: created.id, ...service });
    }
    if (options.publish ?? true) await api.listing.publish({ businessId: created.id });
    await harness.db
      .update(businesses)
      .set({
        plan: options.pro ? "pro" : "free",
        verifiedInsuranceAt: options.verified ? new Date() : null,
      })
      .where(eq(businesses.id, created.id));
    return { id: created.id, slug: created.slug, ctx: person.ctx, userId: person.userId };
  }

  /** Adds a completed job with a customer review of `stars` for the business. */
  async function addReview(id: string, customerId: string, stars: number, month: string) {
    const { db } = harness;
    const [service] = await db.select().from(services).where(eq(services.businessId, id)).limit(1);
    const [address] = await db
      .insert(addresses)
      .values({
        userId: customerId,
        line1: "1 Review Road",
        city: "Halifax",
        province: "NS",
        postalCode: "B3H 1A1",
      })
      .returning();
    const [booking] = await db
      .insert(bookings)
      .values({
        customerId,
        businessId: id,
        serviceId: service?.id ?? "",
        addressId: address?.id ?? "",
        kind: "one_off",
        status: "completed",
        priceCents: 6000,
        serviceFeeCents: 422,
        priceTaxCents: 900,
        feeTaxCents: 63,
        totalCents: 7385,
        taxProvince: "NS",
        cancellationPolicy: "flexible",
      })
      .returning();
    const [ownerMember] = await db
      .select({ id: businessMembers.id })
      .from(businessMembers)
      .where(eq(businessMembers.businessId, id));
    const [visit] = await db
      .insert(visits)
      .values({
        bookingId: booking?.id ?? "",
        businessId: id,
        assignedMemberId: ownerMember?.id ?? null,
        startsAt: new Date(`${month}-10T14:00:00Z`),
        endsAt: new Date(`${month}-10T15:00:00Z`),
        status: "completed",
        completedAt: new Date(`${month}-10T15:00:00Z`),
        confirmedAt: new Date(`${month}-11T15:00:00Z`),
      })
      .returning();
    const [business] = await db.select().from(businesses).where(eq(businesses.id, id));
    await db.insert(reviews).values({
      visitId: visit?.id ?? "",
      bookingId: booking?.id ?? "",
      businessId: id,
      raterUserId: customerId,
      rateeUserId: business?.ownerUserId ?? null,
      raterRole: "customer",
      serviceMonth: month,
      stars,
      comment: "Great work.",
    });
  }

  beforeAll(async () => {
    harness = await createHarness(TEST_DATABASE_URL as string);
    const ownerSignUp = await harness.signUp("olive@example.com", "Olive Owner");
    owner = ownerSignUp.ctx;
    const created = await call(owner).business.create({
      name: "Harbour Lawn & Snow",
      province: "NS",
    });
    businessId = created.id;
    slug = created.slug;
    const managerSignUp = await harness.signUp("manny@example.com", "Manny Manager");
    manager = managerSignUp.ctx;
    await addMember(managerSignUp.userId, businessId, "manager");
    const crewSignUp = await harness.signUp("cris@example.com", "Cris Crew");
    crew = crewSignUp.ctx;
    await addMember(crewSignUp.userId, businessId, "crew");
    outsider = (await harness.signUp("otto@example.com", "Otto Outsider")).ctx;
  });

  afterAll(async () => {
    await harness?.close();
  });

  describe("listing management", () => {
    it("starts unpublished and lists what's missing", async () => {
      const listing = await call(owner).listing.get({ businessId });
      expect(listing.canEdit).toBe(true);
      expect(listing.business.publishedAt).toBeNull();
      expect(listing.readiness.missing.map((item) => item.key)).toEqual([
        "about",
        "service_area",
        "services",
      ]);
      const result = await call(owner).listing.publish({ businessId });
      expect(result.published).toBe(false);
    });

    it("lets crew view but not edit, and hides the business from outsiders", async () => {
      const listing = await call(crew).listing.get({ businessId });
      expect(listing.canEdit).toBe(false);
      expect(listing.business.gstHstNumber).toBeNull();
      const edit = await trpcError(
        call(crew).listing.setServiceArea({ businessId, center: BEDFORD, radiusKm: 10 }),
      );
      expect(edit.code).toBe("FORBIDDEN");
      expect((await trpcError(call(outsider).listing.get({ businessId }))).code).toBe("NOT_FOUND");
      expect((await trpcError(call(harness.anonymous()).listing.get({ businessId }))).code).toBe(
        "UNAUTHORIZED",
      );
    });

    it("saves the profile, normalising the GST/HST number and keeping the slug", async () => {
      await call(manager).listing.updateProfile({
        businessId,
        name: "Harbour Lawn and Snow Co.",
        description: ABOUT,
        gstHstNumber: "123 456 789 rt 0001",
        cancellationPolicy: "strict",
        instantBook: true,
      });
      const [row] = await harness.db.select().from(businesses).where(eq(businesses.id, businessId));
      expect(row).toMatchObject({
        name: "Harbour Lawn and Snow Co.",
        slug,
        gstHstNumber: "123456789RT0001",
        taxRegistered: true,
        cancellationPolicy: "strict",
        instantBook: true,
      });

      const bad = await trpcError(
        call(owner).listing.updateProfile({
          businessId,
          name: "Harbour",
          description: "About\u0007",
          gstHstNumber: "12345",
          cancellationPolicy: "flexible",
          instantBook: false,
        }),
      );
      expect(bad.code).toBe("BAD_REQUEST");
    });

    it("sets one service area in Nova Scotia, labelled with the nearest place", async () => {
      const result = await call(owner).listing.setServiceArea({
        businessId,
        center: BEDFORD,
        radiusKm: 25,
      });
      expect(result.label).toBe("Bedford");
      await call(owner).listing.setServiceArea({ businessId, center: BEDFORD, radiusKm: 30 });
      const rows = await harness.db
        .select()
        .from(serviceAreas)
        .where(eq(serviceAreas.businessId, businessId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.radiusKm).toBe(30);

      const outside = await trpcError(
        call(owner).listing.setServiceArea({ businessId, center: TORONTO, radiusKm: 10 }),
      );
      expect(outside.code).toBe("BAD_REQUEST");
      const tooBig = await trpcError(
        call(owner).listing.setServiceArea({ businessId, center: BEDFORD, radiusKm: 101 }),
      );
      expect(tooBig.code).toBe("BAD_REQUEST");
    });

    it("validates services and keeps them inside their business", async () => {
      const quoteWithPrice = await trpcError(
        call(owner).listing.createService({ businessId, ...snowQuote, priceCents: 5000 }),
      );
      expect(quoteWithPrice.code).toBe("BAD_REQUEST");

      const { id } = await call(owner).listing.createService({ businessId, ...mowing });
      await call(manager).listing.createService({ businessId, ...snowQuote });
      await call(owner).listing.updateService({
        businessId,
        serviceId: id,
        service: { ...mowing, priceCents: 6500, instantBook: false },
      });
      const listing = await call(owner).listing.get({ businessId });
      expect(listing.services.map((service) => [service.title, service.priceText])).toEqual([
        ["Weekly mowing", "$65 / visit"],
        ["Driveway clearing", "Quote · from $45"],
      ]);
      expect(listing.services[0]?.instantBook).toBe(false);
      const [stored] = await harness.db.select().from(services).where(eq(services.id, id));
      expect(stored?.instantBook).toBe(false);

      // Another business can't touch this one's services, even with the id.
      const other = await listBusiness("Other Outfit", {
        center: DARTMOUTH,
        radiusKm: 10,
        services: [cleaning],
        publish: false,
      });
      const foreign = await trpcError(
        call(other.ctx).listing.updateService({
          businessId: other.id,
          serviceId: id,
          service: mowing,
        }),
      );
      expect(foreign.code).toBe("NOT_FOUND");
      const foreignDelete = await trpcError(
        call(other.ctx).listing.deleteService({ businessId: other.id, serviceId: id }),
      );
      expect(foreignDelete.code).toBe("NOT_FOUND");
    });

    it("publishes when ready and unpublishes when an edit breaks readiness", async () => {
      const listing = await call(owner).listing.get({ businessId });
      expect(listing.readiness).toEqual({ ready: true, missing: [] });
      const published = await call(owner).listing.publish({ businessId });
      expect(published.published).toBe(true);

      // Turning off one of two services keeps it published.
      const [first, second] = listing.services;
      const off = await call(owner).listing.updateService({
        businessId,
        serviceId: second?.id ?? "",
        service: { ...snowQuote, active: false },
      });
      expect(off.unpublished).toBe(false);

      // Deleting the last active one unpublishes.
      const removed = await call(owner).listing.deleteService({
        businessId,
        serviceId: first?.id ?? "",
      });
      expect(removed.unpublished).toBe(true);
      const after = await call(owner).listing.get({ businessId });
      expect(after.business.publishedAt).toBeNull();
      expect(after.readiness.missing.map((item) => item.key)).toEqual(["services"]);

      // Back to ready, then a too-short "about" unpublishes too.
      await call(owner).listing.updateService({
        businessId,
        serviceId: second?.id ?? "",
        service: snowQuote,
      });
      await call(owner).listing.createService({ businessId, ...mowing });
      expect((await call(owner).listing.publish({ businessId })).published).toBe(true);
      const short = await call(owner).listing.updateProfile({
        businessId,
        name: "Harbour Lawn and Snow Co.",
        description: "Short.",
        gstHstNumber: "",
        cancellationPolicy: "moderate",
        instantBook: true,
      });
      expect(short.unpublished).toBe(true);
      await call(owner).listing.updateProfile({
        businessId,
        name: "Harbour Lawn and Snow Co.",
        description: ABOUT,
        gstHstNumber: "",
        cancellationPolicy: "moderate",
        instantBook: true,
      });
      expect((await call(owner).listing.publish({ businessId })).published).toBe(true);

      await call(manager).listing.unpublish({ businessId });
      expect((await call(owner).listing.get({ businessId })).business.publishedAt).toBeNull();
      await call(owner).listing.publish({ businessId });
    });
  });

  describe("photos and logo", () => {
    const upload = (ctx: Context, kind: "photo" | "logo", bytes: Uint8Array, id = businessId) =>
      saveBusinessImage({
        db: harness.db,
        storage: harness.storage,
        session: ctx.session,
        businessId: id,
        kind,
        bytes,
      });

    it("stores a clean re-encoded photo for owners and managers only", async () => {
      const bytes = await jpeg();
      const result = await upload(owner, "photo", bytes);
      if (!result.ok) throw new Error(result.message);
      expect(result.url).toMatch(/^\/api\/media\/businesses\/.+\/photos\/.+\.webp$/);
      const key = result.url.replace("/api/media/", "");
      const stored = await harness.storage.get(key);
      expect(stored?.contentType).toBe("image/webp");
      expect((await sharp(stored?.body).metadata()).exif).toBeUndefined();

      expect(await upload(crew, "photo", bytes)).toMatchObject({ ok: false, status: 403 });
      expect(await upload(outsider, "photo", bytes)).toMatchObject({ ok: false, status: 404 });
      expect(await upload(harness.anonymous(), "photo", bytes)).toMatchObject({
        ok: false,
        status: 401,
      });
      const unverified = await harness.signUp("una@example.com", "Una Verified", {
        verify: false,
      });
      expect(await upload(unverified.ctx, "photo", bytes)).toMatchObject({
        ok: false,
        status: 403,
      });
      expect(await upload(owner, "photo", new TextEncoder().encode("not an image"))).toMatchObject({
        ok: false,
        status: 400,
      });
      expect(await upload(owner, "photo", new Uint8Array())).toMatchObject({
        ok: false,
        status: 400,
      });
    });

    it("caps work photos at 8", async () => {
      const bytes = await jpeg(200, 150);
      for (let n = 1; n < 8; n += 1) {
        expect((await upload(manager, "photo", bytes)).ok).toBe(true);
      }
      expect(await upload(owner, "photo", bytes)).toMatchObject({ ok: false, status: 409 });
      const listing = await call(owner).listing.get({ businessId });
      expect(listing.photos).toHaveLength(8);
    });

    it("reorders, captions and deletes photos", async () => {
      const { photos } = await call(owner).listing.get({ businessId });
      const reversed = photos.map((photo) => photo.id).reverse();
      await call(owner).listing.reorderPhotos({ businessId, photoIds: reversed });
      const reordered = await call(owner).listing.get({ businessId });
      expect(reordered.photos.map((photo) => photo.id)).toEqual(reversed);

      const partial = await trpcError(
        call(owner).listing.reorderPhotos({ businessId, photoIds: reversed.slice(1) }),
      );
      expect(partial.code).toBe("CONFLICT");

      const target = reordered.photos[0];
      await call(owner).listing.updatePhoto({
        businessId,
        photoId: target?.id ?? "",
        altText: "Freshly striped lawn in Bedford",
      });
      const key = target?.url.replace("/api/media/", "") ?? "";
      expect(existsSync(join(harness.mediaDir, key))).toBe(true);
      await call(owner).listing.deletePhoto({ businessId, photoId: target?.id ?? "" });
      expect(existsSync(join(harness.mediaDir, key))).toBe(false);
      const after = await call(owner).listing.get({ businessId });
      expect(after.photos).toHaveLength(7);

      const crewDelete = await trpcError(
        call(crew).listing.deletePhoto({ businessId, photoId: after.photos[0]?.id ?? "" }),
      );
      expect(crewDelete.code).toBe("FORBIDDEN");
    });

    it("keeps one logo, deleting the file it replaces", async () => {
      const first = await upload(owner, "logo", await jpeg(900, 300));
      if (!first.ok) throw new Error(first.message);
      expect([first.width, first.height]).toEqual([512, 512]);
      const firstKey = first.url.replace("/api/media/", "");
      const second = await upload(owner, "logo", await jpeg(300, 300));
      if (!second.ok) throw new Error(second.message);
      expect(existsSync(join(harness.mediaDir, firstKey))).toBe(false);
      const listing = await call(owner).listing.get({ businessId });
      expect(listing.business.logoUrl).toBe(second.url);

      await call(owner).listing.removeLogo({ businessId });
      expect(existsSync(join(harness.mediaDir, second.url.replace("/api/media/", "")))).toBe(false);
      expect((await call(owner).listing.get({ businessId })).business.logoUrl).toBeNull();
    });
  });

  describe("search", () => {
    let sydney: Awaited<ReturnType<typeof listBusiness>>;
    let dartmouthPro: Awaited<ReturnType<typeof listBusiness>>;
    let dartmouthFree: Awaited<ReturnType<typeof listBusiness>>;
    let hidden: Awaited<ReturnType<typeof listBusiness>>;
    let customerId: string;

    beforeAll(async () => {
      sydney = await listBusiness("Cape Breton Snow", {
        center: SYDNEY,
        radiusKm: 30,
        services: [{ ...mowing, title: "Cape mowing" }],
        instantBook: true,
      });
      // Two businesses that differ only in plan, at the same spot.
      dartmouthPro = await listBusiness("Zed Cleaning", {
        center: DARTMOUTH,
        radiusKm: 20,
        services: [cleaning],
        pro: true,
        verified: true,
      });
      dartmouthFree = await listBusiness("Able Cleaning", {
        center: DARTMOUTH,
        radiusKm: 20,
        services: [cleaning],
      });
      hidden = await listBusiness("Not Listed Yet", {
        center: DARTMOUTH,
        radiusKm: 20,
        services: [cleaning],
        publish: false,
      });
      customerId = (await harness.signUp("cora@example.com", "Cora Customer Smith")).userId;
    });

    const search = (input: Parameters<ReturnType<typeof call>["search"]["query"]>[0]) =>
      call(harness.anonymous()).search.query(input);

    it("finds businesses whose radius covers the customer's postal area", async () => {
      const halifax = await search({ postalCode: "B3H 1A1" });
      expect(halifax.location).toMatchObject({
        kind: "postal",
        code: "B3H",
        placeName: "Halifax (South End)",
      });
      const names = halifax.results.map((result) => result.name);
      expect(names).toContain("Harbour Lawn and Snow Co.");
      expect(names).toContain("Zed Cleaning");
      expect(names).not.toContain("Cape Breton Snow");
      expect(names).not.toContain("Not Listed Yet");
      expect(names).not.toContain("Other Outfit"); // never published

      const capeBreton = await search({ postalCode: "b1p" });
      expect(capeBreton.results.map((result) => result.name)).toEqual(["Cape Breton Snow"]);
      expect(capeBreton.results[0]).toMatchObject({
        service: { title: "Cape mowing", priceText: "$60 / visit" },
        badges: { instantBook: true, pro: false, verified: false },
        cancellationPolicy: "Moderate",
        rating: null,
      });
    });

    it("filters by category and shows the matching service's price", async () => {
      const lawn = await search({ postalCode: "B3H", category: "lawn-mowing" });
      expect(lawn.results.map((result) => result.name)).toEqual(["Harbour Lawn and Snow Co."]);
      expect(lawn.results[0]?.service.priceText).toBe("$60 / visit");
      const snow = await search({ postalCode: "B3H", category: "snow-ice-removal" });
      expect(snow.results[0]?.service.priceText).toBe("Quote · from $45");
    });

    it("shows approximate pins and distances, never the exact base", async () => {
      const { results } = await search({ postalCode: "B3H" });
      const harbour = results.find((result) => result.name === "Harbour Lawn and Snow Co.");
      expect(harbour?.pin).toEqual({ lat: 44.73, lng: -63.65 });
      expect(harbour?.distanceKm).toBeGreaterThan(5);
      expect(harbour?.distanceText).toMatch(/^\d+ km$/);
      expect(harbour?.areaText).toBe("Serves about 30 km around Bedford");
    });

    it("ranks Pro businesses higher in Best match and discloses it with the badge", async () => {
      const best = await search({ postalCode: "B2Y", category: "house-cleaning" });
      expect(best.results.map((result) => result.name)).toEqual(["Zed Cleaning", "Able Cleaning"]);
      expect(best.results[0]?.badges.pro).toBe(true);
      const closest = await search({
        postalCode: "B2Y",
        category: "house-cleaning",
        sort: "closest",
      });
      // Same distance, so the name decides.
      expect(closest.results.map((result) => result.name)).toEqual([
        "Able Cleaning",
        "Zed Cleaning",
      ]);
    });

    it("applies the Instant Book, Verified, Pro and 4.5+ filters", async () => {
      const verified = await search({ postalCode: "B2Y", verified: true });
      expect(verified.results.map((result) => result.name)).toEqual(["Zed Cleaning"]);
      const pro = await search({ postalCode: "B2Y", pro: "true" });
      expect(pro.results.map((result) => result.name)).toEqual(["Zed Cleaning"]);
      const instant = await search({ postalCode: "B4A", instantBook: true });
      // Harbour has Instant Book on, and its mowing service doesn't opt out.
      expect(instant.results.map((result) => result.name)).toEqual(["Harbour Lawn and Snow Co."]);
      expect(instant.results[0]?.service.title).toBe("Weekly mowing");

      await addReview(dartmouthFree.id, customerId, 5, "2026-06");
      await addReview(dartmouthFree.id, customerId, 4, "2026-07");
      await addReview(dartmouthPro.id, customerId, 3, "2026-06");
      const top = await search({ postalCode: "B2Y", topRated: true });
      expect(top.results.map((result) => result.name)).toEqual(["Able Cleaning"]);
      expect(top.results[0]?.rating).toEqual({ average: 4.5, count: 2 });
      const byRating = await search({
        postalCode: "B2Y",
        category: "house-cleaning",
        sort: "top_rated",
      });
      expect(byRating.results.map((result) => result.name)).toEqual([
        "Able Cleaning",
        "Zed Cleaning",
      ]);
    });

    it("falls back for unknown areas and refuses areas outside Nova Scotia", async () => {
      const sibling = await search({ postalCode: "B3W 1A1" });
      expect(sibling.location).toMatchObject({ kind: "postal", requested: "B3W", code: "B3V" });

      const unknown = await search({ postalCode: "B8X" });
      expect(unknown.location).toEqual({
        kind: "province",
        reason: "unknown_area",
        requested: "B8X",
      });
      expect(unknown.results.length).toBeGreaterThanOrEqual(4);
      expect(unknown.results.every((result) => result.distanceKm === null)).toBe(true);

      const toronto = await search({ postalCode: "M5V 2T6" });
      expect(toronto.location.kind).toBe("outside");
      expect(toronto.results).toEqual([]);

      const invalid = await trpcError(search({ postalCode: "hello" }));
      expect(invalid.code).toBe("BAD_REQUEST");
    });

    it("uses a precise point from 'Use my location' when it is in Nova Scotia", async () => {
      const near = await search({ near: SYDNEY });
      expect(near.location).toEqual({ kind: "near" });
      expect(near.results.map((result) => result.name)).toEqual(["Cape Breton Snow"]);
      const far = await search({ near: TORONTO });
      expect(far.location).toEqual({ kind: "province", reason: "outside_bounds" });
    });

    it("never shows suspended businesses", async () => {
      await harness.db
        .update(businesses)
        .set({ suspendedAt: new Date() })
        .where(eq(businesses.id, sydney.id));
      expect((await search({ postalCode: "B1P" })).results).toEqual([]);
      const gone = await trpcError(call(harness.anonymous()).search.profile({ slug: sydney.slug }));
      expect(gone.code).toBe("NOT_FOUND");
      await harness.db
        .update(businesses)
        .set({ suspendedAt: null })
        .where(eq(businesses.id, sydney.id));
    });

    it("serves the public profile without contact details", async () => {
      await harness.db
        .update(businesses)
        .set({ phone: "+19025550123", email: "private@example.com" })
        .where(eq(businesses.id, dartmouthFree.id));
      const profile = await call(harness.anonymous()).search.profile({ slug: dartmouthFree.slug });
      expect(profile).toMatchObject({
        name: "Able Cleaning",
        about: ABOUT,
        rating: { average: 4.5, count: 2 },
        area: {
          radiusKm: 20,
          description: "Serves about 20 km around Dartmouth (Downtown)",
          center: { lat: 44.67, lng: -63.57 },
        },
        cancellationPolicy: { id: "moderate", label: "Moderate" },
        preview: false,
      });
      expect(profile.services.map((service) => service.priceText)).toEqual(["$120 / visit"]);
      expect(profile.reviews.map((review) => review.author)).toEqual(["Cora S.", "Cora S."]);
      const text = JSON.stringify(profile);
      expect(text).not.toContain("+19025550123");
      expect(text).not.toContain("private@example.com");
    });

    it("previews unpublished pages to members only", async () => {
      const anonymous = await trpcError(
        call(harness.anonymous()).search.profile({ slug: hidden.slug }),
      );
      expect(anonymous.code).toBe("NOT_FOUND");
      const stranger = await trpcError(call(outsider).search.profile({ slug: hidden.slug }));
      expect(stranger.code).toBe("NOT_FOUND");
      const preview = await call(hidden.ctx).search.profile({ slug: hidden.slug });
      expect(preview.preview).toBe(true);
    });

    it("describes a postal code for the search header", async () => {
      const area = await call(harness.anonymous()).search.area({ postalCode: "B4A 2X1" });
      expect(area).toMatchObject({ kind: "found", code: "B4A", placeName: "Bedford" });
      expect(await call(harness.anonymous()).search.area({ postalCode: "K1A" })).toEqual({
        kind: "outside",
        requested: "K1A",
      });
    });

    it("keeps photo rows out of search results for other businesses", async () => {
      const rows = await harness.db
        .select({ businessId: businessPhotos.businessId })
        .from(businessPhotos);
      expect(new Set(rows.map((row) => row.businessId))).toEqual(new Set([businessId]));
    });
  });
});
