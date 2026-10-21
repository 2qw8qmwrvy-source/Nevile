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
  disputes,
  payments,
  payouts,
  quoteRequests,
  quotes,
  refunds,
  reviews,
  serviceCategories,
  services,
  snowContracts,
  tips,
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
    otherOwner: "",
    otherBusinessId: "",
    otherOwnerMemberId: "",
  };
  let nextSequence = 1;

  /** A visit on the fixture booking, held by the owner unless `overrides` say otherwise. */
  const visit = (overrides: Partial<NewVisit> & Pick<NewVisit, "startsAt" | "endsAt">) =>
    db
      .insert(visits)
      .values({
        bookingId: ids.bookingId,
        businessId: ids.businessId,
        assignedMemberId: ids.ownerMemberId,
        sequence: nextSequence++,
        ...overrides,
      })
      .returning({ id: visits.id });

  /** A confirmed booking of `kind` for the fixture customer, with the ON $100 amounts. */
  const booking = async (kind: "one_off" | "recurring" | "snow_contract") => {
    const [row] = await db
      .insert(bookings)
      .values({
        customerId: ids.customer,
        businessId: ids.businessId,
        serviceId: ids.serviceId,
        addressId: ids.addressId,
        kind,
        status: "confirmed",
        priceCents: 10_000,
        serviceFeeCents: 639,
        priceTaxCents: 1_300,
        feeTaxCents: 83,
        totalCents: 12_022,
        taxProvince: "ON",
        cancellationPolicy: "moderate",
      })
      .returning({ id: bookings.id });
    if (!row) throw new Error("booking not created");
    return row.id;
  };

  let nextPaymentIntent = 1;
  /** A payment of the ON $100 amounts (12_022 charged, 300 business fee). */
  const payment = (values: {
    bookingId: string;
    visitId?: string | null;
    businessId?: string;
    status?: "pending" | "succeeded";
    payoutId?: string;
  }) =>
    db
      .insert(payments)
      .values({
        businessId: ids.businessId,
        stripePaymentIntentId: `pi_test_${nextPaymentIntent++}`,
        amountCents: 12_022,
        priceCents: 10_000,
        serviceFeeCents: 639,
        priceTaxCents: 1_300,
        feeTaxCents: 83,
        businessFeeCents: 300,
        status: "succeeded",
        ...values,
      })
      .returning({ id: payments.id });

  beforeAll(async () => {
    const url = TEST_DATABASE_URL as string;
    await resetTestDatabase(url);
    db = createDb(url, { max: 2 });

    const [customer, owner, crew, otherOwner] = await db
      .insert(user)
      .values([
        { id: randomUUID(), name: "Casey Customer", email: "casey@example.com" },
        { id: randomUUID(), name: "Olive Owner", email: "olive@example.com" },
        { id: randomUUID(), name: "Cory Crew", email: "cory@example.com" },
        { id: randomUUID(), name: "Otto Other", email: "otto@example.com" },
      ])
      .returning({ id: user.id });
    if (!customer || !owner || !crew || !otherOwner) throw new Error("fixture users not created");
    ids.customer = customer.id;
    ids.owner = owner.id;
    ids.crew = crew.id;
    ids.otherOwner = otherOwner.id;

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

    // A second, unrelated business.
    const [other] = await db
      .insert(businesses)
      .values({
        ownerUserId: ids.otherOwner,
        name: "Other Snow Co",
        slug: "other-snow-co",
        province: "ON",
      })
      .returning({ id: businesses.id });
    if (!other) throw new Error("fixture business not created");
    ids.otherBusinessId = other.id;
    const [otherMember] = await db
      .insert(businessMembers)
      .values({ businessId: ids.otherBusinessId, userId: ids.otherOwner, role: "owner" })
      .returning({ id: businessMembers.id });
    ids.otherOwnerMemberId = otherMember?.id ?? "";

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
      const declared = (Object.values(schema) as unknown[])
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

    it("resolves every declared relation in relational queries", async () => {
      const tables = (db._.schema ?? {}) as Record<string, { relations: object }>;
      const queries = db.query as unknown as Record<
        string,
        { findFirst: (config: { with: Record<string, true> }) => Promise<unknown> }
      >;
      const tableNames = Object.keys(tables);
      expect(tableNames.length).toBeGreaterThan(30);
      for (const name of tableNames) {
        const relationNames = Object.keys(tables[name]?.relations ?? {});
        const withAll = Object.fromEntries(relationNames.map((key) => [key, true as const]));
        await expect(queries[name]?.findFirst({ with: withAll })).resolves.not.toThrow();
      }
      const owner = await db.query.user.findFirst({
        where: eq(user.id, ids.owner),
        with: { sessions: true, accounts: true, memberships: { with: { business: true } } },
      });
      expect(owner?.memberships[0]?.business.slug).toBe("evergreen-lawn-snow");
    });

    it("records every generated and custom migration in the journal", async () => {
      const result = await db.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`,
      );
      expect(result.rows[0]?.count).toBe(5);
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

    it("allows overlapping visits for different members", async () => {
      await expect(
        visit({
          assignedMemberId: ids.ownerMemberId,
          startsAt: at("2026-11-02T14:30:00Z"),
          endsAt: at("2026-11-02T15:30:00Z"),
        }),
      ).resolves.toHaveLength(1);
    });

    it("requires a crew member on every live visit, so a confirmed slot is always held", async () => {
      const slot = { startsAt: at("2027-11-03T14:00:00Z"), endsAt: at("2027-11-03T15:00:00Z") };
      for (const status of ["confirmed", "completed_pending_confirmation", "completed"] as const) {
        expect(
          await violation(
            visit({
              ...slot,
              assignedMemberId: null,
              status,
              completedAt: at("2027-11-03T15:00:00Z"),
              autoConfirmAt: at("2027-11-05T15:00:00Z"),
              confirmedAt: at("2027-11-03T16:00:00Z"),
            }),
          ),
        ).toEqual({ code: "23514", constraint: "visits_live_has_member" });
      }
      await expect(
        visit({
          ...slot,
          assignedMemberId: null,
          status: "cancelled_by_business",
          cancelledAt: at("2027-11-01T12:00:00Z"),
        }),
      ).resolves.toHaveLength(1);
    });

    it("ignores refunded visits: the slot can be booked again", async () => {
      const slot = { startsAt: at("2027-05-01T14:00:00Z"), endsAt: at("2027-05-01T15:00:00Z") };
      const [refunded] = await visit({ ...slot, assignedMemberId: ids.crewMemberId });
      await db
        .update(visits)
        .set({ status: "refunded" })
        .where(eq(visits.id, refunded?.id ?? ""));
      await expect(visit({ ...slot, assignedMemberId: ids.crewMemberId })).resolves.toHaveLength(1);
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
      ).toEqual({ code: "23505", constraint: "reviews_one_per_side_per_visit" });
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

  describe("crew assignment integrity", () => {
    it("only assigns visits and bookings to members of the booking's business", async () => {
      expect(
        await violation(
          visit({
            assignedMemberId: ids.otherOwnerMemberId,
            startsAt: at("2027-11-04T14:00:00Z"),
            endsAt: at("2027-11-04T15:00:00Z"),
          }),
        ),
      ).toEqual({ code: "23503", constraint: "visits_member_business_fk" });
      // business_id must be the booking's business.
      expect(
        await violation(
          visit({
            businessId: ids.otherBusinessId,
            assignedMemberId: ids.otherOwnerMemberId,
            startsAt: at("2027-11-04T14:00:00Z"),
            endsAt: at("2027-11-04T15:00:00Z"),
          }),
        ),
      ).toEqual({ code: "23503", constraint: "visits_booking_business_fk" });
      expect(
        await violation(
          db
            .update(bookings)
            .set({ assignedMemberId: ids.otherOwnerMemberId })
            .where(eq(bookings.id, ids.bookingId)),
        ),
      ).toEqual({ code: "23503", constraint: "bookings_member_business_fk" });
    });

    it("refuses to remove a member who still holds visits, and frees only booking defaults", async () => {
      const [helper] = await db
        .insert(user)
        .values({ id: randomUUID(), name: "Hal Helper", email: "hal@example.com" })
        .returning({ id: user.id });
      const [member] = await db
        .insert(businessMembers)
        .values({ businessId: ids.businessId, userId: helper?.id ?? "", role: "crew" })
        .returning({ id: businessMembers.id });
      const memberId = member?.id ?? "";
      const bookingId = await booking("recurring");
      await db
        .update(bookings)
        .set({ assignedMemberId: memberId })
        .where(eq(bookings.id, bookingId));
      const [held] = await db
        .insert(visits)
        .values({
          bookingId,
          businessId: ids.businessId,
          assignedMemberId: memberId,
          startsAt: at("2027-12-01T14:00:00Z"),
          endsAt: at("2027-12-01T15:00:00Z"),
        })
        .returning({ id: visits.id });
      // Deleting the user cascades to the membership, which still holds a visit.
      expect(await violation(db.delete(user).where(eq(user.id, helper?.id ?? "")))).toEqual({
        code: "23503",
        constraint: "visits_member_business_fk",
      });
      // Once the visit is reassigned, removing the member clears the booking default only.
      await db
        .update(visits)
        .set({ assignedMemberId: ids.ownerMemberId })
        .where(eq(visits.id, held?.id ?? ""));
      await db.delete(user).where(eq(user.id, helper?.id ?? ""));
      const [after] = await db
        .select({ businessId: bookings.businessId, member: bookings.assignedMemberId })
        .from(bookings)
        .where(eq(bookings.id, bookingId));
      expect(after).toEqual({ businessId: ids.businessId, member: null });
    });
  });

  describe("money integrity", () => {
    it("ties a payment's visit, business and payout to its booking", async () => {
      const oneOff = await booking("one_off");
      const [recurringVisit] = await visit({
        startsAt: at("2027-06-01T14:00:00Z"),
        endsAt: at("2027-06-01T15:00:00Z"),
      });
      // A visit of another booking.
      const otherRecurring = await booking("recurring");
      expect(
        await violation(payment({ bookingId: otherRecurring, visitId: recurringVisit?.id ?? "" })),
      ).toEqual({ code: "23503", constraint: "payments_visit_booking_fk" });
      // Another business than the booking's.
      expect(
        await violation(payment({ bookingId: oneOff, businessId: ids.otherBusinessId })),
      ).toEqual({ code: "23503", constraint: "payments_booking_business_fk" });
      // Another business's payout.
      const [otherPayout] = await db
        .insert(payouts)
        .values({
          businessId: ids.otherBusinessId,
          periodStart: "2027-06-07",
          periodEnd: "2027-06-14",
          amountCents: 0,
        })
        .returning({ id: payouts.id });
      expect(await violation(payment({ bookingId: oneOff, payoutId: otherPayout?.id }))).toEqual({
        code: "23503",
        constraint: "payments_payout_business_fk",
      });
    });

    it("charges a booking in one shape only, never per visit and per booking at once", async () => {
      const oneOff = await booking("one_off");
      const [oneOffVisit] = await db
        .insert(visits)
        .values({
          bookingId: oneOff,
          businessId: ids.businessId,
          assignedMemberId: ids.crewMemberId,
          startsAt: at("2027-06-02T14:00:00Z"),
          endsAt: at("2027-06-02T15:00:00Z"),
        })
        .returning({ id: visits.id });
      await expect(payment({ bookingId: oneOff })).resolves.toHaveLength(1);
      expect(
        await violation(payment({ bookingId: oneOff, visitId: oneOffVisit?.id ?? "" })),
      ).toEqual({ code: "23514", constraint: "payments_charge_shape" });

      // Recurring: per visit only.
      const [recurringVisit] = await visit({
        startsAt: at("2027-06-03T14:00:00Z"),
        endsAt: at("2027-06-03T15:00:00Z"),
      });
      expect(await violation(payment({ bookingId: ids.bookingId }))).toEqual({
        code: "23514",
        constraint: "payments_charge_shape",
      });
      await expect(
        payment({ bookingId: ids.bookingId, visitId: recurringVisit?.id ?? "" }),
      ).resolves.toHaveLength(1);

      // Snow contracts follow their price basis.
      const perVisit = await booking("snow_contract");
      const season = await booking("snow_contract");
      expect(await violation(payment({ bookingId: perVisit }))).toEqual({
        code: "23514",
        constraint: "payments_charge_shape",
      });
      await db.insert(snowContracts).values([
        {
          bookingId: perVisit,
          triggerCm: 5,
          seasonStart: "2027-11-01",
          seasonEnd: "2028-03-31",
          perVisitCents: 10_000,
        },
        {
          bookingId: season,
          triggerCm: 5,
          seasonStart: "2027-11-01",
          seasonEnd: "2028-03-31",
          seasonPriceCents: 10_000,
        },
      ]);
      expect(await violation(payment({ bookingId: perVisit }))).toEqual({
        code: "23514",
        constraint: "payments_charge_shape",
      });
      await expect(payment({ bookingId: season })).resolves.toHaveLength(1);
    });

    it("ties a tip to its visit's booking, customer, business and payout", async () => {
      const [tipped] = await visit({
        startsAt: at("2027-06-04T14:00:00Z"),
        endsAt: at("2027-06-04T15:00:00Z"),
      });
      const tip = {
        visitId: tipped?.id ?? "",
        bookingId: ids.bookingId,
        customerId: ids.customer,
        businessId: ids.businessId,
        amountCents: 500,
      };
      expect(
        await violation(
          db
            .insert(tips)
            .values({ ...tip, businessId: ids.otherBusinessId, stripePaymentIntentId: "pi_tip_1" }),
        ),
      ).toEqual({ code: "23503", constraint: "tips_booking_parties_fk" });
      const otherBooking = await booking("one_off");
      expect(
        await violation(
          db
            .insert(tips)
            .values({ ...tip, bookingId: otherBooking, stripePaymentIntentId: "pi_tip_2" }),
        ),
      ).toEqual({ code: "23503", constraint: "tips_visit_booking_fk" });
      const [ownPayout, otherPayout] = await db
        .insert(payouts)
        .values([
          {
            businessId: ids.businessId,
            periodStart: "2027-06-14",
            periodEnd: "2027-06-21",
            amountCents: 0,
          },
          {
            businessId: ids.otherBusinessId,
            periodStart: "2027-06-14",
            periodEnd: "2027-06-21",
            amountCents: 0,
          },
        ])
        .returning({ id: payouts.id });
      expect(
        await violation(
          db
            .insert(tips)
            .values({ ...tip, payoutId: otherPayout?.id, stripePaymentIntentId: "pi_tip_3" }),
        ),
      ).toEqual({ code: "23503", constraint: "tips_payout_business_fk" });
      const [stored] = await db
        .insert(tips)
        .values({
          ...tip,
          payoutId: ownPayout?.id,
          stripePaymentIntentId: "pi_tip_4",
          stripeChargeId: "ch_tip_4",
          status: "succeeded",
          succeededAt: at("2027-06-04T16:00:00Z"),
          processingFeeCents: 45,
        })
        .returning({ processingFeeCents: tips.processingFeeCents });
      expect(stored?.processingFeeCents).toBe(45);
    });
  });

  describe("refunds", () => {
    /** The moderate late-cancellation refund of the ON $100 job (core refundFor…). */
    const lateCancel = {
      reason: "customer_cancellation" as const,
      status: "succeeded" as const,
      amountCents: 5_650,
      priceCents: 5_000,
      priceTaxCents: 650,
      serviceFeeCents: 0,
      feeTaxCents: 0,
      businessFeeAdjustmentCents: 150,
    };

    it("stores core's refund breakdown, so the business payout is computable", async () => {
      const [paid] = await payment({ bookingId: await booking("one_off") });
      await db.insert(refunds).values({ ...lateCancel, paymentId: paid?.id ?? "" });
      const [row] = await db
        .execute<{ payout: number }>(sql`
        SELECT p.price_cents - sum(r.price_cents)
             - (p.business_fee_cents - sum(r.business_fee_adjustment_cents))
             + p.price_tax_cents - sum(r.price_tax_cents) AS payout
        FROM payments p JOIN refunds r ON r.payment_id = p.id
        WHERE p.id = ${paid?.id ?? ""}
        GROUP BY p.id`)
        .then((result) => result.rows);
      // Core: retained 5000 − 3% fee 150 + retained tax 650.
      expect(Number(row?.payout)).toBe(5_500);
      expect(
        await violation(
          db
            .insert(refunds)
            .values({ ...lateCancel, paymentId: paid?.id ?? "", amountCents: 5_000 }),
        ),
      ).toEqual({ code: "23514", constraint: "refunds_amount_is_sum" });
    });

    it("never refunds more than the payment collected", async () => {
      const [paid] = await payment({ bookingId: await booking("one_off") });
      const paymentId = paid?.id ?? "";
      await db.insert(refunds).values({ ...lateCancel, paymentId });
      // A second identical refund still fits (together they return the whole price);
      // a third would refund more price, tax and fee reduction than was collected.
      await expect(
        db
          .insert(refunds)
          .values({ ...lateCancel, paymentId })
          .returning({ id: refunds.id }),
      ).resolves.toHaveLength(1);
      expect(await violation(db.insert(refunds).values({ ...lateCancel, paymentId }))).toEqual({
        code: "23514",
        constraint: "refunds_within_payment",
      });
      // A single oversized refund.
      const [fresh] = await payment({ bookingId: await booking("one_off") });
      expect(
        await violation(
          db.insert(refunds).values({
            paymentId: fresh?.id ?? "",
            reason: "admin_adjustment",
            amountCents: 999_999,
            priceCents: 999_999,
          }),
        ),
      ).toEqual({ code: "23514", constraint: "refunds_within_payment" });
      // Failed refunds do not count against the payment.
      await db.insert(refunds).values({
        ...lateCancel,
        paymentId: fresh?.id ?? "",
        status: "failed",
      });
      await db.insert(refunds).values({
        paymentId: fresh?.id ?? "",
        reason: "business_cancellation",
        status: "pending",
        amountCents: 12_022,
        priceCents: 10_000,
        serviceFeeCents: 639,
        priceTaxCents: 1_300,
        feeTaxCents: 83,
        businessFeeAdjustmentCents: 300,
      });
    });

    it("only refunds collected payments", async () => {
      const [pending] = await payment({ bookingId: await booking("one_off"), status: "pending" });
      expect(
        await violation(db.insert(refunds).values({ ...lateCancel, paymentId: pending?.id ?? "" })),
      ).toEqual({ code: "23514", constraint: "refunds_within_payment" });
    });
  });

  describe("reviews integrity", () => {
    it("files a review only under the visit's booking and the booking's business", async () => {
      const [rated] = await visit({
        startsAt: at("2027-08-01T14:00:00Z"),
        endsAt: at("2027-08-01T15:00:00Z"),
      });
      const otherBooking = await booking("one_off");
      const review = {
        visitId: rated?.id ?? "",
        bookingId: ids.bookingId,
        businessId: ids.businessId,
        raterUserId: ids.customer,
        rateeUserId: ids.owner,
        raterRole: "customer" as const,
        serviceMonth: "2027-08",
        stars: 2,
      };
      expect(
        await violation(db.insert(reviews).values({ ...review, bookingId: otherBooking })),
      ).toEqual({ code: "23503", constraint: "reviews_visit_booking_fk" });
      expect(
        await violation(db.insert(reviews).values({ ...review, businessId: ids.otherBusinessId })),
      ).toEqual({ code: "23503", constraint: "reviews_booking_business_fk" });
    });

    it("keeps reviews when the author's or the rated user's account is deleted", async () => {
      const [rated] = await visit({
        startsAt: at("2027-09-01T14:00:00Z"),
        endsAt: at("2027-09-01T15:00:00Z"),
      });
      const [manager] = await db
        .insert(user)
        .values({ id: randomUUID(), name: "Mia Manager", email: "mia@example.com" })
        .returning({ id: user.id });
      await db
        .insert(businessMembers)
        .values({ businessId: ids.businessId, userId: manager?.id ?? "", role: "manager" });
      const [review] = await db
        .insert(reviews)
        .values({
          visitId: rated?.id ?? "",
          bookingId: ids.bookingId,
          businessId: ids.businessId,
          raterUserId: manager?.id ?? "",
          rateeUserId: ids.customer,
          raterRole: "business",
          serviceMonth: "2027-09",
          stars: 5,
        })
        .returning({ id: reviews.id });
      await db.delete(user).where(eq(user.id, manager?.id ?? ""));
      const [kept] = await db
        .select({ rater: reviews.raterUserId, ratee: reviews.rateeUserId, stars: reviews.stars })
        .from(reviews)
        .where(eq(reviews.id, review?.id ?? ""));
      expect(kept).toEqual({ rater: null, ratee: ids.customer, stars: 5 });
    });
  });

  describe("disputes", () => {
    it("records a dispute the customer closed by confirming the fix", async () => {
      const [disputed] = await visit({
        startsAt: at("2027-10-01T14:00:00Z"),
        endsAt: at("2027-10-01T15:00:00Z"),
      });
      const [row] = await db
        .insert(disputes)
        .values({
          visitId: disputed?.id ?? "",
          openedByUserId: ids.customer,
          reason: "Missed the back lawn",
          fixDeadline: at("2027-10-05T14:00:00Z"),
        })
        .returning({ id: disputes.id });
      await expect(
        db
          .update(disputes)
          .set({
            status: "resolved",
            resolution: "customer_confirmed",
            resolvedAt: at("2027-10-03T10:00:00Z"),
            resolvedByUserId: ids.customer,
          })
          .where(eq(disputes.id, row?.id ?? ""))
          .returning({ id: disputes.id }),
      ).resolves.toHaveLength(1);
    });
  });

  describe("quote terms", () => {
    const request = async (kind: "one_off" | "recurring" | "snow_contract") => {
      const [row] = await db
        .insert(quoteRequests)
        .values({
          customerId: ids.customer,
          businessId: ids.businessId,
          serviceId: ids.serviceId,
          addressId: ids.addressId,
          kind,
          details: "Front and back lawn",
          expiresAt: at("2027-01-08T00:00:00Z"),
        })
        .returning({ id: quoteRequests.id });
      return row?.id ?? "";
    };
    const quote = (quoteRequestId: string, kind: "one_off" | "recurring" | "snow_contract") => ({
      quoteRequestId,
      kind,
      priceCents: 6_000,
      expiresAt: at("2099-01-08T00:00:00Z"),
    });

    it("stores the recurring terms a recurring quote needs", async () => {
      const id = await request("recurring");
      expect(await violation(db.insert(quotes).values(quote(id, "recurring")))).toEqual({
        code: "23514",
        constraint: "quotes_recurring_terms",
      });
      await expect(
        db
          .insert(quotes)
          .values({
            ...quote(id, "recurring"),
            proposedStart: at("2027-05-03T13:00:00Z"),
            durationMinutes: 60,
            frequency: "biweekly",
            seriesEndsAt: at("2027-10-31T00:00:00Z"),
          })
          .returning({ id: quotes.id }),
      ).resolves.toHaveLength(1);
    });

    it("stores the snow-contract terms, including whether the price is per visit or per season", async () => {
      const id = await request("snow_contract");
      expect(
        await violation(db.insert(quotes).values({ ...quote(id, "snow_contract"), triggerCm: 5 })),
      ).toEqual({ code: "23514", constraint: "quotes_snow_terms" });
      await expect(
        db
          .insert(quotes)
          .values({
            ...quote(id, "snow_contract"),
            priceBasis: "per_visit",
            triggerCm: 5,
            seasonStart: "2027-11-01",
            seasonEnd: "2028-03-31",
          })
          .returning({ id: quotes.id }),
      ).resolves.toHaveLength(1);
    });

    it("matches the request's kind and keeps one-off quotes free of contract terms", async () => {
      const id = await request("one_off");
      expect(await violation(db.insert(quotes).values(quote(id, "recurring")))).toMatchObject({
        code: "23514",
      });
      expect(
        await violation(
          db.insert(quotes).values({
            ...quote(id, "recurring"),
            proposedStart: at("2027-05-03T13:00:00Z"),
            durationMinutes: 60,
            frequency: "weekly",
            seriesEndsAt: at("2027-10-31T00:00:00Z"),
          }),
        ),
      ).toEqual({ code: "23503", constraint: "quotes_request_kind_fk" });
      expect(
        await violation(db.insert(quotes).values({ ...quote(id, "one_off"), frequency: "weekly" })),
      ).toEqual({ code: "23514", constraint: "quotes_recurring_terms" });
      await expect(
        db.insert(quotes).values(quote(id, "one_off")).returning({ id: quotes.id }),
      ).resolves.toHaveLength(1);
    });
  });

  describe("users", () => {
    it("has Nevile-owned admin and suspension columns, not the unused admin plugin's", async () => {
      const result = await db.execute<{ column_name: string }>(
        sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('user', 'session')`,
      );
      const columns = result.rows.map((row) => row.column_name);
      expect(columns).toEqual(
        expect.arrayContaining(["is_platform_admin", "suspended_at", "suspension_reason"]),
      );
      for (const removed of ["role", "banned", "ban_reason", "ban_expires", "impersonated_by"]) {
        expect(columns).not.toContain(removed);
      }
      const [row] = await db
        .select({ admin: user.isPlatformAdmin })
        .from(user)
        .where(eq(user.id, ids.customer));
      expect(row?.admin).toBe(false);
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
      expect(await violation(db.delete(auditLog).where(eq(auditLog.id, entryId)))).toMatchObject({
        code: "42501",
      });
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
