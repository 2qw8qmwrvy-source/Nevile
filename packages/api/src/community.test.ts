import { PUBLIC_REGION_MIN_COMPLETED_JOBS } from "@nevile/core";
import {
  addresses,
  bookings,
  communityFundLedger,
  communityPartnerMembers,
  communityPartners,
  communityReferrals,
  donations,
  eq,
  serviceCategories,
  services,
} from "@nevile/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type ApiConfig, DEFAULT_API_CONFIG } from "./config.ts";
import { createCaller } from "./root.ts";
import { createHarness, type Harness, trpcError } from "./test/harness.ts";
import { API_ERROR_REASONS, errorReasonOf } from "./trpc.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ON: ApiConfig = { ...DEFAULT_API_CONFIG, neighboursEnabled: true };
const OFF: ApiConfig = { ...DEFAULT_API_CONFIG, neighboursEnabled: false };

const referral = {
  homeownerFirstName: "Margaret",
  contactRoute: "Call Joan at the Spryfield seniors' centre",
  addressLine: "12 Example Lane",
  city: "Halifax",
  postalCode: "b3r 1a1",
  regionId: "halifax-regional-municipality",
  categorySlug: "snow-ice-removal",
  preferredTiming: "Weekday mornings",
  consentConfirmed: true,
} as const;

describe.skipIf(!TEST_DATABASE_URL)("community (Nevile Neighbours)", () => {
  let harness: Harness;
  let partnerId: string;
  let staffUserId: string;
  let staffCookie: string;

  beforeAll(async () => {
    harness = await createHarness(TEST_DATABASE_URL as string);
    const [partner] = await harness.db
      .insert(communityPartners)
      .values({
        name: "Spryfield Seniors' Centre",
        kind: "seniors_centre",
        contactEmail: "office@seniors.example",
        regionId: "halifax-regional-municipality",
      })
      .returning();
    partnerId = partner?.id ?? "";
    const staff = await harness.signUp("joan@seniors.example", "Joan");
    staffUserId = staff.userId;
    staffCookie = staff.cookie;
    await harness.db
      .insert(communityPartnerMembers)
      .values({ partnerId, userId: staffUserId, role: "coordinator" });
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("reports the switch, off by default", async () => {
    expect(await createCaller(harness.anonymous()).community.status()).toEqual({ enabled: false });
    expect(await createCaller(harness.anonymous(ON)).community.status()).toEqual({
      enabled: true,
    });
  });

  it("shows an empty impact page with no data", async () => {
    expect(await createCaller(harness.anonymous()).community.impact()).toEqual({
      enabled: false,
      donatedCents: 0,
      feesCents: 0,
      paidToProsCents: 0,
      refundedCents: 0,
      balanceCents: 0,
      completedJobs: 0,
      regions: [],
      regionThreshold: PUBLIC_REGION_MIN_COMPLETED_JOBS,
    });
  });

  it("lists the caller's active partner memberships", async () => {
    const staff = createCaller(await harness.contextFor(staffCookie));
    expect(await staff.community.myPartners()).toEqual([
      {
        id: partnerId,
        name: "Spryfield Seniors' Centre",
        kind: "seniors_centre",
        regionId: "halifax-regional-municipality",
        regionName: "Halifax Regional Municipality",
        role: "coordinator",
      },
    ]);
    const outsider = await harness.signUp("outsider@example.com", "Otto");
    expect(await createCaller(outsider.ctx).community.myPartners()).toEqual([]);
  });

  it("refuses referrals while the program is off", async () => {
    const staff = createCaller(await harness.contextFor(staffCookie, OFF));
    const error = await trpcError(staff.community.submitReferral({ ...referral, partnerId }));
    expect(error.code).toBe("PRECONDITION_FAILED");
    expect(errorReasonOf(error)).toBe(API_ERROR_REASONS.NEIGHBOURS_DISABLED);
    expect(await harness.db.select().from(communityReferrals)).toEqual([]);
  });

  it("accepts referrals only from verified staff of an active partner", async () => {
    const outsider = await harness.signUp("stranger@example.com", "Stan", { config: ON });
    expect(
      (
        await trpcError(
          createCaller(outsider.ctx).community.submitReferral({ ...referral, partnerId }),
        )
      ).code,
    ).toBe("NOT_FOUND");
    expect(
      (
        await trpcError(
          createCaller(outsider.ctx).community.submitReferral({
            ...referral,
            partnerId: "00000000-0000-4000-8000-000000000000",
          }),
        )
      ).code,
    ).toBe("NOT_FOUND");

    const unverified = await harness.signUp("new.staff@seniors.example", "Nell", {
      verify: false,
      config: ON,
    });
    await harness.db
      .insert(communityPartnerMembers)
      .values({ partnerId, userId: unverified.userId });
    const gate = await trpcError(
      createCaller(unverified.ctx).community.submitReferral({ ...referral, partnerId }),
    );
    expect(gate.code).toBe("FORBIDDEN");
    expect(errorReasonOf(gate)).toBe(API_ERROR_REASONS.VERIFICATION_REQUIRED);

    expect(await harness.db.select().from(communityReferrals)).toEqual([]);
  });

  it("stores a minimal referral for admin review without logging it", async () => {
    const log = vi.spyOn(console, "error");
    const info = vi.spyOn(console, "info");
    const staff = createCaller(await harness.contextFor(staffCookie, ON));
    try {
      const created = await staff.community.submitReferral({
        ...referral,
        partnerId,
        notes: "  Side door; the dog is friendly.  ",
      });
      expect(created).toEqual({
        id: expect.any(String),
        status: "pending",
        createdAt: expect.any(Date),
      });

      const [row] = await harness.db
        .select()
        .from(communityReferrals)
        .where(eq(communityReferrals.id, created.id));
      const [category] = await harness.db
        .select({ id: serviceCategories.id })
        .from(serviceCategories)
        .where(eq(serviceCategories.slug, "snow-ice-removal"));
      expect(row).toMatchObject({
        partnerId,
        submittedByUserId: staffUserId,
        homeownerFirstName: "Margaret",
        contactRoute: "Call Joan at the Spryfield seniors' centre",
        addressLine: "12 Example Lane",
        city: "Halifax",
        postalCode: "B3R 1A1",
        regionId: "halifax-regional-municipality",
        categoryId: category?.id,
        preferredTiming: "Weekday mornings",
        notes: "Side door; the dog is friendly.",
        status: "pending",
        consentConfirmedAt: expect.any(Date),
        bookingId: null,
      });
      const logged = [...log.mock.calls, ...info.mock.calls].flat().join(" ");
      expect(logged).not.toContain("Margaret");
      expect(logged).not.toContain("Example Lane");
    } finally {
      log.mockRestore();
      info.mockRestore();
    }
  });

  it("keeps referral contents out of logs and errors when saving fails", async () => {
    const leaky = Object.assign(
      new Error("Failed query: insert ... params: Margaret,12 Example Lane"),
      {
        cause: Object.assign(new Error("new row violates check constraint"), {
          code: "23514",
          constraint: "community_referrals_postal_code_format",
          detail: "Failing row contains (Margaret, 12 Example Lane, ...)",
        }),
      },
    );
    const failingDb = new Proxy(harness.db, {
      get(target, prop, receiver) {
        if (prop !== "insert") return Reflect.get(target, prop, receiver);
        return () => ({
          values: () => ({
            returning: async () => {
              throw leaky;
            },
          }),
        });
      },
    });
    const ctx = await harness.contextFor(staffCookie, ON);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const error = await trpcError(
        createCaller({ ...ctx, db: failingDb }).community.submitReferral({
          ...referral,
          partnerId,
        }),
      );
      expect(error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(error.cause).toBeUndefined();
      expect(JSON.stringify(log.mock.calls)).not.toContain("Margaret");
      expect(log.mock.calls).toEqual([
        [
          "[community] could not save a referral",
          { code: "23514", constraint: "community_referrals_postal_code_format" },
        ],
      ]);
    } finally {
      log.mockRestore();
    }
  });

  it("validates referrals with the strict core schema", async () => {
    const staff = createCaller(await harness.contextFor(staffCookie, ON));
    const before = (await harness.db.select().from(communityReferrals)).length;
    for (const input of [
      { ...referral, partnerId, age: 82 },
      { ...referral, partnerId, consentConfirmed: false },
      { ...referral, partnerId, postalCode: "E1C 4M3" },
      { ...referral, partnerId, regionId: "toronto" },
      { ...referral, partnerId, homeownerFirstName: "   " },
      { ...referral, partnerId: "not-a-uuid" },
    ]) {
      expect((await trpcError(staff.community.submitReferral(input as never))).code).toBe(
        "BAD_REQUEST",
      );
    }

    await harness.db
      .update(serviceCategories)
      .set({ active: false })
      .where(eq(serviceCategories.slug, "window-washing"));
    try {
      expect(
        (
          await trpcError(
            staff.community.submitReferral({
              ...referral,
              partnerId,
              categorySlug: "window-washing",
            }),
          )
        ).code,
      ).toBe("BAD_REQUEST");
    } finally {
      await harness.db
        .update(serviceCategories)
        .set({ active: true })
        .where(eq(serviceCategories.slug, "window-washing"));
    }
    expect(await harness.db.select().from(communityReferrals)).toHaveLength(before);
  });

  it("stops referrals from a deactivated partner", async () => {
    await harness.db
      .update(communityPartners)
      .set({ active: false })
      .where(eq(communityPartners.id, partnerId));
    try {
      const staff = createCaller(await harness.contextFor(staffCookie, ON));
      expect(
        (await trpcError(staff.community.submitReferral({ ...referral, partnerId }))).code,
      ).toBe("NOT_FOUND");
      expect(await staff.community.myPartners()).toEqual([]);
    } finally {
      await harness.db
        .update(communityPartners)
        .set({ active: true })
        .where(eq(communityPartners.id, partnerId));
    }
  });

  it("summarises the ledger and shows only regions with enough completed jobs", async () => {
    const { db } = harness;
    // A Nova Scotia business with a service, and a customer address for the jobs.
    const owner = await harness.signUp("pro@example.com", "Pat Pro");
    const business = await createCaller(owner.ctx).business.create({
      name: "Pat's Snow",
      province: "NS",
    });
    const [category] = await db
      .select({ id: serviceCategories.id })
      .from(serviceCategories)
      .where(eq(serviceCategories.slug, "snow-ice-removal"));
    const [service] = await db
      .insert(services)
      .values({
        businessId: business.id,
        categoryId: category?.id ?? "",
        title: "Driveway clearing",
        pricingType: "fixed",
        priceCents: 6000,
        durationMinutes: 60,
      })
      .returning();
    const [address] = await db
      .insert(addresses)
      .values({
        userId: staffUserId,
        line1: "12 Example Lane",
        city: "Halifax",
        province: "NS",
        postalCode: "B3R 1A1",
      })
      .returning();

    async function completedJob(
      regionId: string,
    ): Promise<{ referralId: string; bookingId: string }> {
      const [booking] = await db
        .insert(bookings)
        .values({
          customerId: staffUserId,
          businessId: business.id,
          serviceId: service?.id ?? "",
          title: "Weekly mowing",
          addressId: address?.id ?? "",
          kind: "one_off",
          status: "completed",
          priceCents: 6000,
          serviceFeeCents: 422,
          priceTaxCents: 840,
          feeTaxCents: 59,
          totalCents: 7321,
          taxProvince: "NS",
          cancellationPolicy: "flexible",
        })
        .returning({ id: bookings.id });
      const [row] = await db
        .insert(communityReferrals)
        .values({
          partnerId,
          submittedByUserId: staffUserId,
          homeownerFirstName: "Neighbour",
          contactRoute: "Through the centre",
          addressLine: "12 Example Lane",
          city: "Halifax",
          postalCode: "B3R 1A1",
          regionId,
          categoryId: category?.id ?? "",
          consentConfirmedAt: new Date(),
          status: "completed",
          reviewedAt: new Date(),
          bookingId: booking?.id ?? null,
        })
        .returning({ id: communityReferrals.id });
      return { referralId: row?.id ?? "", bookingId: booking?.id ?? "" };
    }

    const jobs = [];
    for (let n = 0; n < PUBLIC_REGION_MIN_COMPLETED_JOBS; n += 1) {
      jobs.push(await completedJob("cape-breton"));
    }
    for (let n = 0; n < PUBLIC_REGION_MIN_COMPLETED_JOBS - 1; n += 1) {
      await completedJob("south-shore");
    }

    const [donation] = await db
      .insert(donations)
      .values({
        donorUserId: owner.userId,
        kind: "custom",
        amountCents: 10000,
        feeCents: 290,
        netCents: 9710,
        status: "succeeded",
        succeededAt: new Date(),
      })
      .returning({ id: donations.id });
    await db.insert(communityFundLedger).values([
      { kind: "donation", amountCents: 10000, donationId: donation?.id },
      { kind: "fee", amountCents: -290, donationId: donation?.id },
      {
        kind: "payout",
        amountCents: -7321,
        referralId: jobs[0]?.referralId,
        bookingId: jobs[0]?.bookingId,
      },
    ]);

    expect(await createCaller(harness.anonymous(ON)).community.impact()).toEqual({
      enabled: true,
      donatedCents: 10000,
      feesCents: 290,
      paidToProsCents: 7321,
      refundedCents: 0,
      balanceCents: 2389,
      completedJobs: PUBLIC_REGION_MIN_COMPLETED_JOBS * 2 - 1,
      regions: [
        {
          regionId: "cape-breton",
          name: "Cape Breton",
          completedJobs: PUBLIC_REGION_MIN_COMPLETED_JOBS,
        },
      ],
      regionThreshold: PUBLIC_REGION_MIN_COMPLETED_JOBS,
    });
  });
});
