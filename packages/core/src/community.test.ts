import { describe, expect, it } from "vitest";
import { CATEGORY_SLUGS } from "./categories.ts";
import {
  assertReferralTransition,
  canTransitionReferral,
  isFinalReferralStatus,
  isNsRegionId,
  isReferralStatus,
  LEDGER_ENTRY_KINDS,
  type LedgerEntry,
  NS_REGION_IDS,
  NS_REGIONS,
  nsRegion,
  PUBLIC_REGION_MIN_COMPLETED_JOBS,
  publicRegions,
  REFERRAL_NOTES_HINT,
  REFERRAL_STATUSES,
  REFERRAL_TRANSITIONS,
  type ReferralStatus,
  referralInputSchema,
  summarizeLedger,
} from "./community.ts";
import { donationBreakdown } from "./donations.ts";

describe("NS_REGIONS", () => {
  it("lists the agreed Nova Scotia regions", () => {
    expect(NS_REGION_IDS).toEqual([
      "halifax-regional-municipality",
      "cape-breton",
      "annapolis-valley",
      "south-shore",
      "northern-nova-scotia",
      "eastern-nova-scotia",
      "yarmouth-acadian-shores",
    ]);
    expect(NS_REGIONS.map((region) => region.name)).toEqual([
      "Halifax Regional Municipality",
      "Cape Breton",
      "Annapolis Valley",
      "South Shore",
      "Northern Nova Scotia",
      "Eastern Nova Scotia",
      "Yarmouth & Acadian Shores",
    ]);
  });

  it("describes the grouped regions", () => {
    expect(nsRegion("northern-nova-scotia").description).toBe(
      "Truro, Colchester, Cumberland and Pictou",
    );
    expect(nsRegion("eastern-nova-scotia").description).toBe(
      "Antigonish, Guysborough and the Eastern Shore",
    );
    for (const region of NS_REGIONS) {
      expect(region.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(region.description.length).toBeGreaterThan(0);
    }
  });

  it("recognises region ids", () => {
    expect(isNsRegionId("cape-breton")).toBe(true);
    expect(isNsRegionId("Cape Breton")).toBe(false);
    expect(isNsRegionId("toronto")).toBe(false);
    expect(isNsRegionId(undefined)).toBe(false);
    expect(() => nsRegion("toronto" as never)).toThrow(RangeError);
  });
});

describe("referral statuses", () => {
  it("match SPEC §15", () => {
    expect(REFERRAL_STATUSES).toEqual([
      "pending",
      "approved",
      "declined",
      "booked",
      "completed",
      "cancelled",
    ]);
    expect(Object.keys(REFERRAL_TRANSITIONS).sort()).toEqual([...REFERRAL_STATUSES].sort());
  });

  const allowed: [ReferralStatus, ReferralStatus][] = [
    ["pending", "approved"],
    ["pending", "declined"],
    ["pending", "cancelled"],
    ["approved", "booked"],
    ["approved", "cancelled"],
    ["booked", "completed"],
    ["booked", "approved"],
    ["booked", "cancelled"],
  ];

  it.each(allowed)("allows %s → %s", (from, to) => {
    expect(canTransitionReferral(from, to)).toBe(true);
    expect(() => assertReferralTransition(from, to)).not.toThrow();
  });

  it("refuses every other change, including staying put", () => {
    const allowedKeys = new Set(allowed.map(([from, to]) => `${from}>${to}`));
    for (const from of REFERRAL_STATUSES) {
      for (const to of REFERRAL_STATUSES) {
        if (allowedKeys.has(`${from}>${to}`)) continue;
        expect(canTransitionReferral(from, to)).toBe(false);
        expect(() => assertReferralTransition(from, to)).toThrow(RangeError);
      }
    }
  });

  it("only reaches a booking through approval", () => {
    expect(canTransitionReferral("pending", "booked")).toBe(false);
    expect(canTransitionReferral("declined", "approved")).toBe(false);
  });

  it("knows the final statuses", () => {
    expect(REFERRAL_STATUSES.filter(isFinalReferralStatus)).toEqual([
      "declined",
      "completed",
      "cancelled",
    ]);
  });

  it("rejects unknown statuses", () => {
    expect(isReferralStatus("approved")).toBe(true);
    expect(isReferralStatus("archived")).toBe(false);
    expect(canTransitionReferral("archived" as ReferralStatus, "approved")).toBe(false);
    expect(canTransitionReferral("pending", "archived" as ReferralStatus)).toBe(false);
  });
});

describe("referralInputSchema", () => {
  const valid = {
    homeownerFirstName: "  Margaret ",
    contactRoute: "Call Ann at the Dartmouth Seniors' Centre, 902-555-0142",
    addressLine: "12 Pleasant St",
    city: "Dartmouth",
    postalCode: "b2y3r4",
    regionId: "halifax-regional-municipality",
    categorySlug: "snow-ice-removal",
    preferredTiming: " Weekday mornings ",
    notes: "Side door, ramp access.",
    consentConfirmed: true,
  };

  it("accepts and normalizes a referral", () => {
    expect(referralInputSchema.parse(valid)).toEqual({
      homeownerFirstName: "Margaret",
      contactRoute: "Call Ann at the Dartmouth Seniors' Centre, 902-555-0142",
      addressLine: "12 Pleasant St",
      city: "Dartmouth",
      postalCode: "B2Y 3R4",
      regionId: "halifax-regional-municipality",
      categorySlug: "snow-ice-removal",
      preferredTiming: "Weekday mornings",
      notes: "Side door, ramp access.",
      consentConfirmed: true,
    });
  });

  it("treats timing and notes as optional, dropping blanks", () => {
    const { preferredTiming: _timing, notes: _notes, ...required } = valid;
    expect(referralInputSchema.parse(required)).not.toHaveProperty("notes");
    const blank = referralInputSchema.parse({ ...valid, preferredTiming: "  ", notes: "" });
    expect(blank.preferredTiming).toBeUndefined();
    expect(blank.notes).toBeUndefined();
  });

  it("documents the notes guidance on the schema", () => {
    expect(REFERRAL_NOTES_HINT).toMatch(/health, disability, age or income/);
    expect(referralInputSchema.shape.notes.description).toBe(REFERRAL_NOTES_HINT);
    // Nothing is rejected on content: free text cannot be screened reliably.
    expect(referralInputSchema.safeParse({ ...valid, notes: "Uses a walker." }).success).toBe(true);
  });

  it.each([
    ["homeownerFirstName", ""],
    ["homeownerFirstName", "   "],
    ["homeownerFirstName", "a".repeat(61)],
    ["contactRoute", ""],
    ["contactRoute", "a".repeat(201)],
    ["addressLine", ""],
    ["addressLine", "a".repeat(201)],
    ["city", ""],
    ["city", "a".repeat(101)],
    ["postalCode", "M5V 3L9"],
    ["postalCode", "nope"],
    ["regionId", "toronto"],
    ["categorySlug", "plumbing"],
    ["preferredTiming", "a".repeat(201)],
    ["notes", "a".repeat(1001)],
    ["consentConfirmed", false],
    ["consentConfirmed", "true"],
  ])("rejects %s = %j", (field, value) => {
    const result = referralInputSchema.safeParse({ ...valid, [field]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });

  it("accepts the maximum lengths", () => {
    const result = referralInputSchema.safeParse({
      ...valid,
      homeownerFirstName: "a".repeat(60),
      contactRoute: "a".repeat(200),
      addressLine: "a".repeat(200),
      city: "a".repeat(100),
      preferredTiming: "a".repeat(200),
      notes: "a".repeat(1000),
    });
    expect(result.success).toBe(true);
  });

  it("requires consent and explains why", () => {
    const { consentConfirmed: _consent, ...withoutConsent } = valid;
    const result = referralInputSchema.safeParse(withoutConsent);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Confirm that the homeowner agreed to this referral",
    );
  });

  it("refuses the Nova Scotia check with the launch message", () => {
    const result = referralInputSchema.safeParse({ ...valid, postalCode: "E1C 4M3" });
    expect(result.error?.issues[0]?.message).toBe("Nevile is only in Nova Scotia for now.");
  });

  it.each(["age", "healthConditions", "income", "lastName", "email"])(
    "rejects extra personal details (%s)",
    (field) => {
      expect(referralInputSchema.safeParse({ ...valid, [field]: "x" }).success).toBe(false);
    },
  );

  it("accepts every category and region", () => {
    for (const categorySlug of CATEGORY_SLUGS) {
      for (const regionId of NS_REGION_IDS) {
        expect(referralInputSchema.safeParse({ ...valid, categorySlug, regionId }).success).toBe(
          true,
        );
      }
    }
  });
});

describe("summarizeLedger", () => {
  it("derives the impact totals and the fund balance", () => {
    const two = donationBreakdown(200);
    const five = donationBreakdown(500);
    const entries: LedgerEntry[] = [
      { kind: "donation", amountCents: two.amountCents },
      { kind: "fee", amountCents: -two.feeCents },
      { kind: "donation", amountCents: five.amountCents },
      { kind: "fee", amountCents: -five.feeCents },
      { kind: "donation", amountCents: 79 },
      { kind: "fee", amountCents: -2 },
      { kind: "refund", amountCents: -79 },
      { kind: "payout", amountCents: -300 },
      { kind: "adjustment", amountCents: 10 },
    ];
    expect(summarizeLedger(entries)).toEqual({
      donatedCents: 779,
      feesCents: 23, // 6 + 15 + 2
      paidToProsCents: 300,
      refundedCents: 79,
      balanceCents: 779 - 23 - 300 - 79 + 10,
    });
  });

  it("nets reversals of the same kind", () => {
    const summary = summarizeLedger([
      { kind: "payout", amountCents: -5000 },
      { kind: "payout", amountCents: 5000 }, // booking refunded back into the fund
      { kind: "donation", amountCents: 1000 },
    ]);
    expect(summary.paidToProsCents).toBe(0);
    expect(summary.balanceCents).toBe(1000);
  });

  it("is all zeros (never -0) for an empty ledger", () => {
    const summary = summarizeLedger([]);
    expect(summary).toEqual({
      donatedCents: 0,
      feesCents: 0,
      paidToProsCents: 0,
      refundedCents: 0,
      balanceCents: 0,
    });
    for (const value of Object.values(summary)) expect(Object.is(value, 0)).toBe(true);
  });

  it("balance always equals the sum of every row", () => {
    const entries: LedgerEntry[] = [];
    let expected = 0;
    for (let i = 0; i < 200; i++) {
      const kind = LEDGER_ENTRY_KINDS[i % LEDGER_ENTRY_KINDS.length] ?? "adjustment";
      const amountCents = kind === "donation" ? 100 + i : -(i % 17);
      entries.push({ kind, amountCents });
      expected += amountCents;
    }
    const summary = summarizeLedger(entries);
    expect(summary.balanceCents).toBe(expected);
  });

  it("accepts any iterable", () => {
    function* rows(): Generator<LedgerEntry> {
      yield { kind: "donation", amountCents: 500 };
      yield { kind: "fee", amountCents: -15 };
    }
    expect(summarizeLedger(rows()).balanceCents).toBe(485);
  });

  it("rejects malformed rows", () => {
    expect(() => summarizeLedger([{ kind: "tip" as never, amountCents: 1 }])).toThrow(
      /unknown ledger kind/,
    );
    expect(() => summarizeLedger([{ kind: "donation", amountCents: 1.5 }])).toThrow(/entries\[0\]/);
    expect(() =>
      summarizeLedger([
        { kind: "donation", amountCents: 1 },
        { kind: "fee", amountCents: Number.NaN },
      ]),
    ).toThrow(/entries\[1\]/);
  });
});

describe("publicRegions", () => {
  it("shows only regions with at least 3 completed jobs, in region order", () => {
    expect(PUBLIC_REGION_MIN_COMPLETED_JOBS).toBe(3);
    expect(
      publicRegions({
        "south-shore": 3,
        "halifax-regional-municipality": 12,
        "cape-breton": 2,
        "annapolis-valley": 0,
      }),
    ).toEqual([
      {
        regionId: "halifax-regional-municipality",
        name: "Halifax Regional Municipality",
        completedJobs: 12,
      },
      { regionId: "south-shore", name: "South Shore", completedJobs: 3 },
    ]);
  });

  it("hides everything below the threshold", () => {
    expect(publicRegions({})).toEqual([]);
    expect(publicRegions({ "cape-breton": 2, "south-shore": 1 })).toEqual([]);
  });

  it("takes a custom threshold", () => {
    expect(publicRegions({ "cape-breton": 2 }, 2)).toEqual([
      { regionId: "cape-breton", name: "Cape Breton", completedJobs: 2 },
    ]);
    expect(publicRegions({ "cape-breton": 9 }, 10)).toEqual([]);
  });

  it("rejects bad input", () => {
    expect(() => publicRegions({ toronto: 5 } as never)).toThrow(/unknown region/);
    expect(() => publicRegions({ "cape-breton": -1 })).toThrow(RangeError);
    expect(() => publicRegions({ "cape-breton": 3.5 })).toThrow(RangeError);
    for (const min of [0, -3, 1.5, Number.NaN]) {
      expect(() => publicRegions({}, min)).toThrow(/min/);
    }
  });
});
