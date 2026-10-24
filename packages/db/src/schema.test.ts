import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CATEGORIES } from "@nevile/core";
import { eq, getTableName, inArray, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "./client.ts";
import { MIGRATIONS_FOLDER } from "./migrate.ts";
import * as schema from "./schema/index.ts";
import {
  addresses,
  auditLog,
  bookings,
  businesses,
  businessMembers,
  communityFundLedger,
  communityPartnerMembers,
  communityPartners,
  communityReferrals,
  conversations,
  disputes,
  donations,
  messages,
  payments,
  payouts,
  privatePhotos,
  profiles,
  quoteRequestGroups,
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
import type {
  NewCommunityFundLedgerEntry,
  NewCommunityReferral,
  NewDonation,
  NewProfile,
  NewVisit,
} from "./types.ts";

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
        workMinutes: 60,
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
        title: "Weekly mowing",
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
        title: "Weekly mowing",
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
      const journal = JSON.parse(
        readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
      ) as { entries: unknown[] };
      expect(journal.entries.length).toBeGreaterThanOrEqual(7);
      expect(result.rows[0]?.count).toBe(journal.entries.length);
      const extension = await db.execute<{ extname: string }>(
        sql`SELECT extname FROM pg_extension WHERE extname = 'btree_gist'`,
      );
      expect(extension.rows).toHaveLength(1);
    });
  });

  describe("visits in arrival windows (SPEC §19)", () => {
    it("lets one crew member hold several jobs in the same window", async () => {
      const window = { startsAt: at("2026-11-02T12:00:00Z"), endsAt: at("2026-11-02T15:00:00Z") };
      await expect(
        visit({ ...window, assignedMemberId: ids.crewMemberId, workMinutes: 60 }),
      ).resolves.toHaveLength(1);
      await expect(
        visit({ ...window, assignedMemberId: ids.crewMemberId, workMinutes: 60 }),
      ).resolves.toHaveLength(1);
    });

    it("allows live visits that are not assigned yet", async () => {
      await expect(
        visit({
          startsAt: at("2027-11-03T12:00:00Z"),
          endsAt: at("2027-11-03T15:00:00Z"),
          assignedMemberId: null,
        }),
      ).resolves.toHaveLength(1);
    });

    it("keeps the work time within a day", async () => {
      const window = { startsAt: at("2027-11-04T12:00:00Z"), endsAt: at("2027-11-04T15:00:00Z") };
      for (const workMinutes of [0, 1441]) {
        expect(await violation(visit({ ...window, workMinutes }))).toEqual({
          code: "23514",
          constraint: "visits_work_minutes_range",
        });
      }
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
            title: "Weekly mowing",
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
          workMinutes: 60,
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
          workMinutes: 60,
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
      const [group] = await db
        .insert(quoteRequestGroups)
        .values({
          customerId: ids.customer,
          categoryId: ids.categoryId,
          kind,
          details: "Front and back lawn",
          postalCode: "B3H 1A1",
          postalArea: "B3H",
          timing: "flexible",
        })
        .returning({ id: quoteRequestGroups.id });
      const [row] = await db
        .insert(quoteRequests)
        .values({
          groupId: group?.id ?? "",
          customerId: ids.customer,
          businessId: ids.businessId,
          serviceId: ids.serviceId,
          kind,
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

  describe("quote requests and private photos (SPEC §20)", () => {
    const group = async () => {
      const [row] = await db
        .insert(quoteRequestGroups)
        .values({
          customerId: ids.customer,
          categoryId: ids.categoryId,
          details: "Gutters on a two-storey house",
          postalCode: "B3H 1A1",
          postalArea: "B3H",
          timing: "asap",
        })
        .returning({ id: quoteRequestGroups.id });
      return row?.id ?? "";
    };
    const copy = (groupId: string) => ({
      groupId,
      customerId: ids.customer,
      businessId: ids.businessId,
      serviceId: ids.serviceId,
      expiresAt: at("2027-01-04T00:00:00Z"),
    });

    it("sends each pro one copy of a request", async () => {
      const groupId = await group();
      await db.insert(quoteRequests).values(copy(groupId));
      expect(await violation(db.insert(quoteRequests).values(copy(groupId)))).toEqual({
        code: "23505",
        constraint: "quote_requests_group_business_unique",
      });
    });

    it("keeps a decline reason exactly on declined requests and a close reason on closed ones", async () => {
      expect(
        await violation(
          db.insert(quoteRequests).values({ ...copy(await group()), status: "declined" }),
        ),
      ).toEqual({ code: "23514", constraint: "quote_requests_decline_reason" });
      expect(
        await violation(
          db.insert(quoteRequests).values({ ...copy(await group()), declineReason: "Too far" }),
        ),
      ).toEqual({ code: "23514", constraint: "quote_requests_decline_reason" });
      expect(
        await violation(
          db.insert(quoteRequests).values({ ...copy(await group()), status: "expired" }),
        ),
      ).toEqual({ code: "23514", constraint: "quote_requests_close_reason" });
      await expect(
        db
          .insert(quoteRequests)
          .values({ ...copy(await group()), status: "expired", closeReason: "no_reply" })
          .returning({ id: quoteRequests.id }),
      ).resolves.toHaveLength(1);
    });

    it("stores only area-shaped postal areas", async () => {
      expect(
        await violation(
          db.insert(quoteRequestGroups).values({
            customerId: ids.customer,
            categoryId: ids.categoryId,
            details: "Leaves",
            postalCode: "B3H 1A1",
            postalArea: "B3H 1A1",
            timing: "flexible",
          }),
        ),
      ).toEqual({ code: "23514", constraint: "quote_request_groups_postal_area" });
    });

    it("attaches a private photo to at most one request or message", async () => {
      const groupId = await group();
      const photo = {
        ownerUserId: ids.customer,
        width: 800,
        height: 600,
        quoteRequestGroupId: groupId,
      };
      await expect(
        db
          .insert(privatePhotos)
          .values({ ...photo, storageKey: `private/quotes/${randomUUID()}.webp` })
          .returning({ id: privatePhotos.id }),
      ).resolves.toHaveLength(1);
      const [conversation] = await db
        .insert(conversations)
        .values({
          customerId: ids.customer,
          businessId: ids.businessId,
          quoteRequestId: (
            await db.insert(quoteRequests).values(copy(groupId)).returning({ id: quoteRequests.id })
          )[0]?.id,
        })
        .returning({ id: conversations.id });
      const [message] = await db
        .insert(messages)
        .values({
          conversationId: conversation?.id ?? "",
          senderUserId: ids.customer,
          senderRole: "customer",
          body: "",
          maskedBody: "",
        })
        .returning({ id: messages.id });
      expect(
        await violation(
          db.insert(privatePhotos).values({
            ...photo,
            storageKey: `private/chat/${randomUUID()}.webp`,
            messageId: message?.id,
          }),
        ),
      ).toEqual({ code: "23514", constraint: "private_photos_one_owner" });
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

  describe("profiles: onboarding and marketing consent", () => {
    let profileId = "";
    const update = (values: Partial<NewProfile>) =>
      db.update(profiles).set(values).where(eq(profiles.id, profileId));

    beforeAll(async () => {
      const [row] = await db
        .insert(profiles)
        .values({ userId: ids.customer, displayName: "Casey Customer" })
        .returning();
      if (!row) throw new Error("fixture profile not created");
      profileId = row.id;
      expect(row).toMatchObject({
        postalCode: null,
        onboardingIntent: null,
        interests: [],
        onboardedAt: null,
        marketingConsentAt: null,
        marketingConsentVersion: null,
      });
    });

    it("stores the sign-up postal code in canonical A1A 1A1 form, for any province", async () => {
      for (const postalCode of ["B3H 1A1", "M5E 1W7"]) {
        await update({ postalCode });
      }
      for (const postalCode of ["b3h 1a1", "B3H1A1", "B3H  1A1", "D3H 1A1", "B3H 1A"]) {
        expect(await violation(update({ postalCode }))).toEqual({
          code: "23514",
          constraint: "profiles_postal_code_format",
        });
      }
      await update({ postalCode: null });
    });

    it("records the onboarding answers", async () => {
      const onboardedAt = at("2026-10-21T12:00:00Z");
      await update({
        onboardingIntent: "both",
        interests: ["lawn-mowing", "snow-ice-removal"],
        onboardedAt,
      });
      const [row] = await db.select().from(profiles).where(eq(profiles.id, profileId));
      expect(row).toMatchObject({
        onboardingIntent: "both",
        interests: ["lawn-mowing", "snow-ice-removal"],
        onboardedAt,
      });
      expect(
        await violation(
          db.execute(sql`UPDATE profiles SET onboarding_intent = 'admin' WHERE id = ${profileId}`),
        ),
      ).toMatchObject({ code: "22P02" });
    });

    it("keeps interests to a short list of category slugs", async () => {
      const rejected = [
        update({ interests: ["Lawn Mowing"] }),
        update({ interests: [""] }),
        update({ interests: ["lawn-mowing,snow-ice-removal"] }),
        update({ interests: ['"quoted"'] }),
        update({ interests: Array.from({ length: 33 }, (_, i) => `service-${i}`) }),
        db.execute(
          sql`UPDATE profiles SET interests = ARRAY['lawn-mowing', NULL] WHERE id = ${profileId}`,
        ),
        db.execute(
          sql`UPDATE profiles SET interests = '{{lawn-mowing},{snow-ice-removal}}' WHERE id = ${profileId}`,
        ),
      ];
      for (const query of rejected) {
        expect(await violation(query)).toEqual({
          code: "23514",
          constraint: "profiles_interests_format",
        });
      }
      await update({ interests: Array.from({ length: 32 }, (_, i) => `service-${i}`) });
      await update({ interests: [] });
    });

    it("records marketing consent as a timestamp and consent-text version pair (CASL)", async () => {
      const consentAt = at("2026-10-21T12:00:00Z");
      for (const values of [
        { marketingConsentAt: consentAt, marketingConsentVersion: null },
        { marketingConsentAt: null, marketingConsentVersion: "2026-10-casl-v1" },
      ]) {
        expect(await violation(update(values))).toEqual({
          code: "23514",
          constraint: "profiles_marketing_consent_pair",
        });
      }
      expect(
        await violation(update({ marketingConsentAt: consentAt, marketingConsentVersion: " " })),
      ).toEqual({ code: "23514", constraint: "profiles_marketing_consent_version_not_blank" });
      await update({ marketingConsentAt: consentAt, marketingConsentVersion: "2026-10-casl-v1" });
      // Withdrawing consent clears both.
      await update({ marketingConsentAt: null, marketingConsentVersion: null });
    });
  });

  describe("community referrals", () => {
    let partnerId = "";
    let staffUserId = "";

    const referral = (overrides: Partial<NewCommunityReferral> = {}) =>
      db
        .insert(communityReferrals)
        .values({
          partnerId,
          submittedByUserId: staffUserId,
          homeownerFirstName: "June",
          contactRoute: "Call the Bayview Seniors' Centre front desk",
          addressLine: "12 Main St",
          city: "Halifax",
          postalCode: "B3H 1A1",
          regionId: "halifax-regional-municipality",
          categoryId: ids.categoryId,
          preferredTiming: "Weekday mornings",
          consentConfirmedAt: at("2026-10-20T15:00:00Z"),
          ...overrides,
        })
        .returning({ id: communityReferrals.id });

    beforeAll(async () => {
      const [staff] = await db
        .insert(user)
        .values({ id: randomUUID(), name: "Pat Partner", email: "pat@example.com" })
        .returning({ id: user.id });
      staffUserId = staff?.id ?? "";
      const [partner] = await db
        .insert(communityPartners)
        .values({
          name: "Bayview Seniors' Centre",
          kind: "seniors_centre",
          contactEmail: "hello@bayview.example",
          regionId: "halifax-regional-municipality",
          createdByUserId: ids.owner,
        })
        .returning({ id: communityPartners.id, active: communityPartners.active });
      partnerId = partner?.id ?? "";
      expect(partner?.active).toBe(true);
      await db
        .insert(communityPartnerMembers)
        .values({ partnerId, userId: staffUserId, role: "coordinator" });
    });

    it("lets a person join a partner once, and keeps region ids as slugs", async () => {
      expect(
        await violation(
          db.insert(communityPartnerMembers).values({ partnerId, userId: staffUserId }),
        ),
      ).toEqual({ code: "23505", constraint: "community_partner_members_partner_user_unique" });
      expect(
        await violation(
          db.insert(communityPartners).values({
            name: "Cape Breton Helpers",
            kind: "support_agency",
            contactEmail: "info@cbh.example",
            regionId: "Cape Breton",
          }),
        ),
      ).toEqual({ code: "23514", constraint: "community_partners_region_id_format" });
    });

    it("requires the partner's consent confirmation and a canonical address", async () => {
      expect(await violation(referral({ postalCode: "B3H1A1" }))).toEqual({
        code: "23514",
        constraint: "community_referrals_postal_code_format",
      });
      expect(await violation(referral({ regionId: "Halifax" }))).toEqual({
        code: "23514",
        constraint: "community_referrals_region_id_format",
      });
      const [created] = await referral();
      const referralId = created?.id ?? "";
      const [row] = await db
        .select()
        .from(communityReferrals)
        .where(eq(communityReferrals.id, referralId));
      expect(row?.status).toBe("pending");
      expect(
        await violation(
          db.execute(
            sql`UPDATE community_referrals SET consent_confirmed_at = NULL WHERE id = ${referralId}`,
          ),
        ),
      ).toMatchObject({ code: "23502" });
    });

    it("records the admin decision, and a reason for every decline", async () => {
      const reviewedAt = at("2026-10-21T12:00:00Z");
      expect(await violation(referral({ status: "approved" }))).toEqual({
        code: "23514",
        constraint: "community_referrals_reviewed",
      });
      expect(
        await violation(referral({ status: "declined", reviewedAt, reviewedByUserId: ids.owner })),
      ).toEqual({ code: "23514", constraint: "community_referrals_decline_reason" });
      await expect(
        referral({
          status: "declined",
          reviewedAt,
          reviewedByUserId: ids.owner,
          declineReason: "Outside the partner's area",
        }),
      ).resolves.toHaveLength(1);
      // A partner may withdraw a referral before review.
      await expect(referral({ status: "cancelled" })).resolves.toHaveLength(1);
    });

    it("ties booked and completed referrals to exactly one booking", async () => {
      const reviewedAt = at("2026-10-21T12:00:00Z");
      const jobId = await booking("one_off");
      expect(await violation(referral({ status: "booked", reviewedAt }))).toEqual({
        code: "23514",
        constraint: "community_referrals_booking",
      });
      expect(
        await violation(referral({ status: "approved", reviewedAt, bookingId: jobId })),
      ).toEqual({ code: "23514", constraint: "community_referrals_booking" });
      await expect(
        referral({ status: "booked", reviewedAt, bookingId: jobId }),
      ).resolves.toHaveLength(1);
      expect(
        await violation(referral({ status: "completed", reviewedAt, bookingId: jobId })),
      ).toEqual({ code: "23505", constraint: "community_referrals_booking_id_unique" });
      // Partners with referrals are deactivated, never deleted.
      expect(
        await violation(db.delete(communityPartners).where(eq(communityPartners.id, partnerId))),
      ).toEqual({
        code: "23503",
        constraint: "community_referrals_partner_id_community_partners_id_fk",
      });
    });
  });

  describe("donations", () => {
    let jobId = "";
    let paymentId = "";

    /** $2.00 preset: 6¢ card fee, $1.94 to the fund (SPEC §15). */
    const donation = (overrides: Partial<NewDonation> = {}) =>
      db
        .insert(donations)
        .values({
          donorUserId: ids.customer,
          bookingId: jobId,
          kind: "preset",
          amountCents: 200,
          feeCents: 6,
          netCents: 194,
          ...overrides,
        })
        .returning({ id: donations.id });

    beforeAll(async () => {
      jobId = await booking("one_off");
      const [paid] = await payment({ bookingId: jobId });
      paymentId = paid?.id ?? "";
    });

    it("keeps net = amount − fee, with a positive amount and no negative fee", async () => {
      expect(await violation(donation({ netCents: 200 }))).toEqual({
        code: "23514",
        constraint: "donations_net_is_amount_less_fee",
      });
      expect(await violation(donation({ amountCents: 0, feeCents: 0, netCents: 0 }))).toEqual({
        code: "23514",
        constraint: "donations_amount_cents_positive",
      });
      expect(await violation(donation({ feeCents: -1, netCents: 201 }))).toEqual({
        code: "23514",
        constraint: "donations_fee_cents_non_negative",
      });
      expect(
        await violation(
          donation({ kind: "round_up", amountCents: 101, feeCents: 3, netCents: 98 }),
        ),
      ).toEqual({ code: "23514", constraint: "donations_round_up_range" });
      await expect(
        donation({ kind: "round_up", amountCents: 100, feeCents: 3, netCents: 97 }),
      ).resolves.toHaveLength(1);
    });

    it("comes from the booking's own customer, on the booking's own payment", async () => {
      expect(await violation(donation({ donorUserId: ids.otherOwner }))).toEqual({
        code: "23503",
        constraint: "donations_booking_customer_fk",
      });
      const [otherPayment] = await payment({ bookingId: await booking("one_off") });
      expect(await violation(donation({ paymentId: otherPayment?.id ?? "" }))).toEqual({
        code: "23503",
        constraint: "donations_payment_booking_fk",
      });
      expect(await violation(donation({ bookingId: null, paymentId }))).toEqual({
        code: "23514",
        constraint: "donations_payment_has_booking",
      });
      await expect(donation({ paymentId })).resolves.toHaveLength(1);
      expect(await violation(donation({ paymentId }))).toEqual({
        code: "23505",
        constraint: "donations_payment_id_unique",
      });
    });

    it("timestamps success and refund", async () => {
      expect(await violation(donation({ status: "succeeded" }))).toEqual({
        code: "23514",
        constraint: "donations_status_fields",
      });
      const succeededAt = at("2026-10-21T12:00:00Z");
      expect(await violation(donation({ status: "refunded", succeededAt }))).toEqual({
        code: "23514",
        constraint: "donations_status_fields",
      });
      await expect(
        donation({ status: "refunded", succeededAt, refundedAt: at("2026-10-22T12:00:00Z") }),
      ).resolves.toHaveLength(1);
    });
  });

  describe("community_fund_ledger", () => {
    let donationId = "";
    let referralId = "";
    let referralBookingId = "";
    let otherBookingId = "";

    const entry = (values: NewCommunityFundLedgerEntry) =>
      db.insert(communityFundLedger).values(values).returning({ id: communityFundLedger.id });

    /** The fund balance: always derived from the ledger, never stored. */
    const balance = async () => {
      const result = await db.execute<{ balance: number }>(
        sql`SELECT coalesce(sum(amount_cents), 0)::int AS balance FROM community_fund_ledger`,
      );
      return result.rows[0]?.balance ?? Number.NaN;
    };

    beforeAll(async () => {
      const jobId = await booking("one_off");
      // $10.00 custom donation: 29¢ card fee, $9.71 to the fund.
      const [given] = await db
        .insert(donations)
        .values({
          donorUserId: ids.customer,
          bookingId: jobId,
          kind: "custom",
          amountCents: 1_000,
          feeCents: 29,
          netCents: 971,
          status: "succeeded",
          succeededAt: at("2026-10-21T12:00:00Z"),
        })
        .returning({ id: donations.id });
      donationId = given?.id ?? "";

      referralBookingId = await booking("one_off");
      otherBookingId = await booking("one_off");
      const [partner] = await db
        .insert(communityPartners)
        .values({
          name: "North End Community Supports",
          kind: "support_agency",
          contactEmail: "help@northend.example",
          regionId: "halifax-regional-municipality",
        })
        .returning({ id: communityPartners.id });
      const [referred] = await db
        .insert(communityReferrals)
        .values({
          partnerId: partner?.id ?? "",
          homeownerFirstName: "Ray",
          contactRoute: "Through the North End front desk",
          addressLine: "40 Agricola St",
          city: "Halifax",
          postalCode: "B3K 4H6",
          regionId: "halifax-regional-municipality",
          categoryId: ids.categoryId,
          consentConfirmedAt: at("2026-10-20T15:00:00Z"),
          status: "booked",
          reviewedAt: at("2026-10-21T09:00:00Z"),
          bookingId: referralBookingId,
        })
        .returning({ id: communityReferrals.id });
      referralId = referred?.id ?? "";
    });

    it("checks the sign of every kind of entry", async () => {
      // An unknown donation id passes the trigger, so the CHECK is what rejects these.
      const unknownDonation = randomUUID();
      const payout = { referralId, bookingId: referralBookingId };
      for (const values of [
        { kind: "donation", amountCents: -100, donationId: unknownDonation },
        { kind: "donation", amountCents: 0, donationId: unknownDonation },
        { kind: "fee", amountCents: 29, donationId: unknownDonation },
        { kind: "refund", amountCents: 100, donationId: donationId },
        { kind: "payout", amountCents: 100, ...payout },
        { kind: "payout", amountCents: 0, ...payout },
        { kind: "adjustment", amountCents: 0, memo: "Nothing" },
      ] satisfies NewCommunityFundLedgerEntry[]) {
        expect(await violation(entry(values)), values.kind).toEqual({
          code: "23514",
          constraint: "community_fund_ledger_amount_sign",
        });
      }
    });

    it("links each entry to what it accounts for, and explains adjustments", async () => {
      expect(await violation(entry({ kind: "donation", amountCents: 1_000 }))).toEqual({
        code: "23514",
        constraint: "community_fund_ledger_links",
      });
      expect(
        await violation(entry({ kind: "donation", amountCents: 1_000, donationId, referralId })),
      ).toEqual({ code: "23514", constraint: "community_fund_ledger_links" });
      for (const memo of [undefined, "  "]) {
        expect(await violation(entry({ kind: "adjustment", amountCents: 500, memo }))).toEqual({
          code: "23514",
          constraint: "community_fund_ledger_adjustment_memo",
        });
      }
    });

    it("credits a donation, its card fee and its refund once each, at the donation's amounts", async () => {
      const before = await balance();
      expect(await violation(entry({ kind: "donation", amountCents: 999, donationId }))).toEqual({
        code: "23514",
        constraint: "community_fund_ledger_matches_donation",
      });
      expect(
        await violation(
          entry({ kind: "donation", amountCents: 1_000, donationId, bookingId: otherBookingId }),
        ),
      ).toEqual({ code: "23514", constraint: "community_fund_ledger_matches_donation" });
      await entry({ kind: "donation", amountCents: 1_000, donationId });
      expect(await violation(entry({ kind: "donation", amountCents: 1_000, donationId }))).toEqual({
        code: "23505",
        constraint: "community_fund_ledger_one_per_donation_kind_uidx",
      });
      expect(await violation(entry({ kind: "fee", amountCents: -30, donationId }))).toEqual({
        code: "23514",
        constraint: "community_fund_ledger_matches_donation",
      });
      await entry({ kind: "fee", amountCents: -29, donationId });
      expect(await violation(entry({ kind: "refund", amountCents: -1_001, donationId }))).toEqual({
        code: "23514",
        constraint: "community_fund_ledger_matches_donation",
      });
      // Only the net reaches the fund.
      expect((await balance()) - before).toBe(971);
    });

    it("pays out only for the referral's booking, and never more than the fund holds", async () => {
      const held = await balance();
      expect(held).toBeGreaterThan(0);
      const payout = (amountCents: number, bookingId = referralBookingId) =>
        entry({ kind: "payout", amountCents, referralId, bookingId, memo: "Lawn mow for Ray" });

      expect(await violation(payout(-1, otherBookingId))).toEqual({
        code: "23514",
        constraint: "community_fund_ledger_payout_booking",
      });
      expect(
        await violation(
          entry({
            kind: "payout",
            amountCents: -1,
            referralId,
            bookingId: referralBookingId,
            donationId,
          }),
        ),
      ).toEqual({ code: "23514", constraint: "community_fund_ledger_links" });
      expect(await violation(payout(-(held + 1)))).toEqual({
        code: "23514",
        constraint: "community_fund_ledger_balance",
      });
      await payout(-held);
      expect(await balance()).toBe(0);

      // A donation refund is never blocked, even after the money was spent: the fund goes
      // negative until an adjustment covers it.
      await entry({ kind: "refund", amountCents: -1_000, donationId });
      expect(await balance()).toBe(-1_000);
      await entry({ kind: "adjustment", amountCents: 1_000, memo: "Nevile covers refund" });
      expect(await balance()).toBe(0);
    });

    it("serializes concurrent payouts so they cannot spend the same money", async () => {
      await entry({ kind: "adjustment", amountCents: 5_000, memo: "Opening grant" });
      const url = TEST_DATABASE_URL as string;
      const first = createDb(url, { max: 1 });
      const second = createDb(url, { max: 1 });
      try {
        const insertPayout = sql`INSERT INTO community_fund_ledger (kind, amount_cents, referral_id, booking_id)
          VALUES ('payout', -5000, ${referralId}, ${referralBookingId})`;
        await first.execute(sql`BEGIN`);
        await first.execute(insertPayout);
        await second.execute(sql`BEGIN`);
        const racing = violation(second.execute(insertPayout));
        // Wait until the second payout is queued behind the first one's lock.
        for (let attempt = 0; ; attempt++) {
          const result = await db.execute<{ waiting: number }>(
            sql`SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`,
          );
          if ((result.rows[0]?.waiting ?? 0) > 0) break;
          if (attempt === 300) throw new Error("the second payout never waited for the first");
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await first.execute(sql`COMMIT`);
        expect(await racing).toEqual({
          code: "23514",
          constraint: "community_fund_ledger_balance",
        });
        await second.execute(sql`ROLLBACK`);
      } finally {
        await first.$client.end();
        await second.$client.end();
      }
      expect(await balance()).toBe(0);
    });

    it("is append-only, and keeps what it references", async () => {
      const [kept] = await entry({ kind: "adjustment", amountCents: 1, memo: "Rounding" });
      const entryId = kept?.id ?? "";
      expect(
        await violation(
          db
            .update(communityFundLedger)
            .set({ amountCents: 1_000_000 })
            .where(eq(communityFundLedger.id, entryId)),
        ),
      ).toMatchObject({ code: "42501" });
      expect(
        await violation(db.delete(communityFundLedger).where(eq(communityFundLedger.id, entryId))),
      ).toMatchObject({ code: "42501" });
      expect(await violation(db.execute(sql`TRUNCATE community_fund_ledger`))).toMatchObject({
        code: "42501",
      });
      expect(await violation(db.execute(sql`TRUNCATE donations CASCADE`))).toMatchObject({
        code: "42501",
      });
      expect(await violation(db.delete(donations).where(eq(donations.id, donationId)))).toEqual({
        code: "23503",
        constraint: "community_fund_ledger_donation_id_donations_id_fk",
      });
      expect(
        await violation(db.delete(communityReferrals).where(eq(communityReferrals.id, referralId))),
      ).toEqual({
        code: "23503",
        constraint: "community_fund_ledger_referral_id_community_referrals_id_fk",
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
