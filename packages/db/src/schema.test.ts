import { randomUUID } from "node:crypto";
import { DEFAULT_CATEGORIES } from "@nevile/core";
import { eq, getTableName, inArray, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "./client.ts";
import * as schema from "./schema/index.ts";
import {
  addresses,
  auditLog,
  bookings,
  businesses,
  businessMembers,
  reviews,
  serviceCategories,
  services,
  user,
  visits,
} from "./schema/index.ts";
import { seedCategories } from "./seed.ts";
import { resetTestDatabase } from "./testing.ts";
import type { NewVisit } from "./types.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DATABASE_URL) {
  console.warn("TEST_DATABASE_URL is not set; skipping @nevile/db database tests.");
}

type Violation = { code: string | undefined; constraint: string | undefined };

/** Runs `query` and returns the Postgres error it raised (Drizzle wraps it in `cause`). */
async function violation(query: PromiseLike<unknown>): Promise<Violation | null> {
  try {
    await query;
    return null;
  } catch (error) {
    let current: unknown = error;
    while (current && typeof current === "object") {
      if ("code" in current && typeof current.code === "string") {
        const constraint = "constraint" in current ? current.constraint : undefined;
        return {
          code: current.code,
          constraint: typeof constraint === "string" ? constraint : undefined,
        };
      }
      current = "cause" in current ? current.cause : undefined;
    }
    throw error;
  }
}

const at = (iso: string) => new Date(iso);

describe.skipIf(!TEST_DATABASE_URL)("@nevile/db schema", () => {
  let db: Database;
  const ids = {
    customer: "",
    owner: "",
    crew: "",
    businessId: "",
    ownerMemberId: "",
    crewMemberId: "",
    categoryId: "",
    serviceId: "",
    addressId: "",
    bookingId: "",
  };
  let nextSequence = 1;

  const visit = (overrides: Partial<NewVisit> & Pick<NewVisit, "startsAt" | "endsAt">) =>
    db
      .insert(visits)
      .values({ bookingId: ids.bookingId, sequence: nextSequence++, ...overrides })
      .returning({ id: visits.id });

  beforeAll(async () => {
    const url = TEST_DATABASE_URL as string;
    await resetTestDatabase(url);
    db = createDb(url, { max: 2 });

    const [customer, owner, crew] = await db
      .insert(user)
      .values([
        { id: randomUUID(), name: "Casey Customer", email: "casey@example.com" },
        { id: randomUUID(), name: "Olive Owner", email: "olive@example.com" },
        { id: randomUUID(), name: "Cory Crew", email: "cory@example.com" },
      ])
      .returning({ id: user.id });
    if (!customer || !owner || !crew) throw new Error("fixture users not created");
    ids.customer = customer.id;
    ids.owner = owner.id;
    ids.crew = crew.id;

    const [business] = await db
      .insert(businesses)
      .values({
        ownerUserId: ids.owner,
        name: "Evergreen Lawn & Snow",
        slug: "evergreen-lawn-snow",
        province: "ON",
        taxRegistered: true,
        gstHstNumber: "123456789RT0001",
      })
      .returning({ id: businesses.id });
    if (!business) throw new Error("fixture business not created");
    ids.businessId = business.id;

    const members = await db
      .insert(businessMembers)
      .values([
        { businessId: ids.businessId, userId: ids.owner, role: "owner" },
        { businessId: ids.businessId, userId: ids.crew, role: "crew" },
      ])
      .returning({ id: businessMembers.id, role: businessMembers.role });
    ids.ownerMemberId = members.find((m) => m.role === "owner")?.id ?? "";
    ids.crewMemberId = members.find((m) => m.role === "crew")?.id ?? "";

    const [category] = await db
      .insert(serviceCategories)
      .values({ slug: "test-category", name: "Test Category" })
      .returning({ id: serviceCategories.id });
    if (!category) throw new Error("fixture category not created");
    ids.categoryId = category.id;

    const [service] = await db
      .insert(services)
      .values({
        businessId: ids.businessId,
        categoryId: ids.categoryId,
        title: "Front lawn mow",
        pricingType: "fixed",
        priceCents: 10_000,
        durationMinutes: 60,
      })
      .returning({ id: services.id });
    if (!service) throw new Error("fixture service not created");
    ids.serviceId = service.id;

    const [address] = await db
      .insert(addresses)
      .values({
        userId: ids.customer,
        line1: "1 Yonge St",
        city: "Toronto",
        province: "ON",
        postalCode: "M5E 1W7",
        lat: 43.6426,
        lng: -79.3755,
      })
      .returning({ id: addresses.id });
    if (!address) throw new Error("fixture address not created");
    ids.addressId = address.id;

    const [booking] = await db
      .insert(bookings)
      .values({
        customerId: ids.customer,
        businessId: ids.businessId,
        serviceId: ids.serviceId,
        addressId: ids.addressId,
        kind: "recurring",
        status: "confirmed",
        priceCents: 10_000,
        serviceFeeCents: 639,
        priceTaxCents: 1_300,
        feeTaxCents: 83,
        totalCents: 12_022,
        taxProvince: "ON",
        cancellationPolicy: "flexible",
      })
      .returning({ id: bookings.id });
    if (!booking) throw new Error("fixture booking not created");
    ids.bookingId = booking.id;
  });

  afterAll(async () => {
    await db?.$client.end();
  });

  describe("migrations", () => {
    it("creates every table declared in the Drizzle schema", async () => {
      const declared = Object.values(schema)
        .filter((value): value is PgTable => is(value, PgTable))
        .map((table) => getTableName(table))
        .sort();
      const result = await db.execute<{ table_name: string }>(
        sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
      );
      expect(result.rows.map((row) => row.table_name)).toEqual(declared);
      expect(declared).toEqual(
        expect.arrayContaining([
          "user",
          "session",
          "account",
          "verification",
          "rate_limit",
          "bookings",
          "visits",
          "payments",
          "reviews",
          "audit_log",
        ]),
      );
    });

    it("records the generated and the custom migration in the journal", async () => {
      const result = await db.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`,
      );
      expect(result.rows[0]?.count).toBe(2);
      const extension = await db.execute<{ extname: string }>(
        sql`SELECT extname FROM pg_extension WHERE extname = 'btree_gist'`,
      );
      expect(extension.rows).toHaveLength(1);
    });
  });

  describe("visits_no_member_overlap exclusion constraint", () => {
    it("rejects overlapping live visits for the same member", async () => {
      await visit({
        assignedMemberId: ids.crewMemberId,
        startsAt: at("2026-11-02T14:00:00Z"),
        endsAt: at("2026-11-02T15:00:00Z"),
      });
      expect(
        await violation(
          visit({
            assignedMemberId: ids.crewMemberId,
            startsAt: at("2026-11-02T14:30:00Z"),
            endsAt: at("2026-11-02T15:30:00Z"),
          }),
        ),
      ).toEqual({ code: "23P01", constraint: "visits_no_member_overlap" });
      // Fully contained ranges overlap too.
      expect(
        await violation(
          visit({
            assignedMemberId: ids.crewMemberId,
            startsAt: at("2026-11-02T14:15:00Z"),
            endsAt: at("2026-11-02T14:45:00Z"),
          }),
        ),
      ).toMatchObject({ code: "23P01" });
    });

    it("allows back-to-back visits for the same member", async () => {
      await expect(
        visit({
          assignedMemberId: ids.crewMemberId,
          startsAt: at("2026-11-02T15:00:00Z"),
          endsAt: at("2026-11-02T16:00:00Z"),
        }),
      ).resolves.toHaveLength(1);
      await expect(
        visit({
          assignedMemberId: ids.crewMemberId,
          startsAt: at("2026-11-02T13:00:00Z"),
          endsAt: at("2026-11-02T14:00:00Z"),
        }),
      ).resolves.toHaveLength(1);
    });

    it("allows overlapping visits for different members and for unassigned visits", async () => {
      await expect(
        visit({
          assignedMemberId: ids.ownerMemberId,
          startsAt: at("2026-11-02T14:30:00Z"),
          endsAt: at("2026-11-02T15:30:00Z"),
        }),
      ).resolves.toHaveLength(1);
      await expect(
        visit({ startsAt: at("2026-11-02T14:30:00Z"), endsAt: at("2026-11-02T15:30:00Z") }),
      ).resolves.toHaveLength(1);
      await expect(
        visit({ startsAt: at("2026-11-02T14:30:00Z"), endsAt: at("2026-11-02T15:30:00Z") }),
      ).resolves.toHaveLength(1);
    });

    it("ignores cancelled visits, but not once they are re-activated", async () => {
      const [cancelled] = await visit({
        assignedMemberId: ids.crewMemberId,
        startsAt: at("2026-11-02T14:30:00Z"),
        endsAt: at("2026-11-02T15:30:00Z"),
        status: "cancelled_by_customer",
        cancelledAt: at("2026-11-01T12:00:00Z"),
      });
      expect(cancelled).toBeDefined();
      await expect(
        visit({
          assignedMemberId: ids.crewMemberId,
          startsAt: at("2026-11-02T14:30:00Z"),
          endsAt: at("2026-11-02T15:30:00Z"),
          status: "cancelled_by_business",
          cancelledAt: at("2026-11-01T12:00:00Z"),
        }),
      ).resolves.toHaveLength(1);
      expect(
        await violation(
          db
            .update(visits)
            .set({ status: "confirmed", cancelledAt: null })
            .where(eq(visits.id, cancelled?.id ?? "")),
        ),
      ).toEqual({ code: "23P01", constraint: "visits_no_member_overlap" });
    });

    it("rejects moving a visit onto another of the member's visits", async () => {
      const [moved] = await visit({
        assignedMemberId: ids.crewMemberId,
        startsAt: at("2026-11-03T14:00:00Z"),
        endsAt: at("2026-11-03T15:00:00Z"),
      });
      expect(
        await violation(
          db
            .update(visits)
            .set({ startsAt: at("2026-11-02T14:30:00Z"), endsAt: at("2026-11-02T15:30:00Z") })
            .where(eq(visits.id, moved?.id ?? "")),
        ),
      ).toMatchObject({ code: "23P01" });
    });
  });

  describe("check constraints", () => {
    it("requires a price on fixed-price services and none on quote services", async () => {
      const base = {
        businessId: ids.businessId,
        categoryId: ids.categoryId,
        title: "Gutters",
        durationMinutes: 90,
      };
      expect(
        await violation(db.insert(services).values({ ...base, pricingType: "fixed" })),
      ).toEqual({ code: "23514", constraint: "services_price_matches_pricing_type" });
      expect(
        await violation(
          db.insert(services).values({ ...base, pricingType: "quote", priceCents: 5_000 }),
        ),
      ).toEqual({ code: "23514", constraint: "services_price_matches_pricing_type" });
      expect(
        await violation(
          db.insert(services).values({ ...base, pricingType: "fixed", priceCents: -1 }),
        ),
      ).toEqual({ code: "23514", constraint: "services_price_cents_non_negative" });
      await expect(
        db
          .insert(services)
          .values({ ...base, pricingType: "quote", fromPriceCents: 15_000 })
          .returning({ id: services.id }),
      ).resolves.toHaveLength(1);
    });

    it("keeps booking totals equal to the sum of their lines", async () => {
      expect(
        await violation(
          db.insert(bookings).values({
            customerId: ids.customer,
            businessId: ids.businessId,
            serviceId: ids.serviceId,
            addressId: ids.addressId,
            kind: "one_off",
            status: "confirmed",
            priceCents: 10_000,
            serviceFeeCents: 639,
            totalCents: 10_000,
            taxProvince: "ON",
            cancellationPolicy: "strict",
          }),
        ),
      ).toEqual({ code: "23514", constraint: "bookings_total_is_sum" });
    });

    it("limits stars to 1–5", async () => {
      const [rated] = await visit({
        assignedMemberId: ids.crewMemberId,
        startsAt: at("2026-11-10T14:00:00Z"),
        endsAt: at("2026-11-10T15:00:00Z"),
      });
      const review = (stars: number, serviceMonth: string) => ({
        visitId: rated?.id ?? "",
        bookingId: ids.bookingId,
        businessId: ids.businessId,
        raterUserId: ids.customer,
        rateeUserId: ids.owner,
        raterRole: "customer" as const,
        serviceMonth,
        stars,
      });
      for (const stars of [0, 6, -1]) {
        expect(await violation(db.insert(reviews).values(review(stars, "2026-11")))).toEqual({
          code: "23514",
          constraint: "reviews_stars_range",
        });
      }
      await expect(
        db.insert(reviews).values(review(5, "2026-11")).returning({ id: reviews.id }),
      ).resolves.toHaveLength(1);
      await db.delete(reviews).where(eq(reviews.visitId, rated?.id ?? ""));
      await expect(
        db.insert(reviews).values(review(1, "2026-11")).returning({ id: reviews.id }),
      ).resolves.toHaveLength(1);
    });
  });

  describe("reviews uniqueness", () => {
    it("allows one review per rater per visit, one per side", async () => {
      const [done] = await visit({
        assignedMemberId: ids.crewMemberId,
        startsAt: at("2026-12-01T14:00:00Z"),
        endsAt: at("2026-12-01T15:00:00Z"),
      });
      const visitId = done?.id ?? "";
      const byCustomer = {
        visitId,
        bookingId: ids.bookingId,
        businessId: ids.businessId,
        raterUserId: ids.customer,
        rateeUserId: ids.owner,
        raterRole: "customer" as const,
        serviceMonth: "2026-12",
        stars: 4,
      };
      await db.insert(reviews).values(byCustomer);
      // Same rater, same visit — even when filed under another month.
      expect(
        await violation(db.insert(reviews).values({ ...byCustomer, serviceMonth: "2027-01" })),
      ).toEqual({ code: "23505", constraint: "reviews_one_per_rater_per_visit" });
      // The business may rate the customer for the same visit.
      await expect(
        db
          .insert(reviews)
          .values({
            ...byCustomer,
            raterUserId: ids.owner,
            rateeUserId: ids.customer,
            raterRole: "business",
          })
          .returning({ id: reviews.id }),
      ).resolves.toHaveLength(1);
    });

    it("caps each side at one review per booking per month of service", async () => {
      const [first, second] = await Promise.all([
        visit({ startsAt: at("2027-02-01T14:00:00Z"), endsAt: at("2027-02-01T15:00:00Z") }),
        visit({ startsAt: at("2027-02-15T14:00:00Z"), endsAt: at("2027-02-15T15:00:00Z") }),
      ]);
      const base = {
        bookingId: ids.bookingId,
        businessId: ids.businessId,
        raterUserId: ids.customer,
        rateeUserId: ids.owner,
        raterRole: "customer" as const,
        serviceMonth: "2027-02",
        stars: 5,
      };
      await db.insert(reviews).values({ ...base, visitId: first?.[0]?.id ?? "" });
      expect(
        await violation(db.insert(reviews).values({ ...base, visitId: second?.[0]?.id ?? "" })),
      ).toEqual({ code: "23505", constraint: "reviews_one_per_side_per_month" });
    });
  });

  describe("audit_log", () => {
    it("is append-only", async () => {
      const [entry] = await db
        .insert(auditLog)
        .values({
          actorUserId: ids.owner,
          action: "payment.captured",
          entity: "payment",
          entityId: randomUUID(),
          data: { amountCents: 12_022 },
        })
        .returning({ id: auditLog.id });
      const entryId = entry?.id ?? "";
      expect(
        await violation(
          db.update(auditLog).set({ action: "tampered" }).where(eq(auditLog.id, entryId)),
        ),
      ).toMatchObject({ code: "42501" });
      expect(await violation(db.delete(auditLog).where(eq(auditLog.id, entryId)))).toMatchObject(
        { code: "42501" },
      );
      expect(await violation(db.execute(sql`TRUNCATE audit_log`))).toMatchObject({
        code: "42501",
      });
    });
  });

  describe("seedCategories", () => {
    it("upserts DEFAULT_CATEGORIES idempotently", async () => {
      const slugs = DEFAULT_CATEGORIES.map((category) => category.slug);
      expect(slugs.length).toBeGreaterThan(0);

      expect(await seedCategories(db)).toBe(DEFAULT_CATEGORIES.length);
      expect(await seedCategories(db)).toBe(0);

      const [first] = DEFAULT_CATEGORIES;
      await db
        .update(serviceCategories)
        .set({ name: "Renamed", active: false })
        .where(eq(serviceCategories.slug, first?.slug ?? ""));
      expect(await seedCategories(db)).toBe(1);

      const rows = await db
        .select()
        .from(serviceCategories)
        .where(inArray(serviceCategories.slug, slugs));
      expect(rows).toHaveLength(DEFAULT_CATEGORIES.length);
      const restored = rows.find((row) => row.slug === first?.slug);
      expect(restored?.name).toBe(first?.name);
      // Admin toggles survive re-seeding.
      expect(restored?.active).toBe(false);
    });
  });
});
