import { describe, expect, it } from "vitest";
import {
  type PaidAmounts,
  refundForBusinessCancellation,
  refundForCustomerCancellation,
} from "./cancellation.ts";
import {
  DONATION_CARD_FEE_BPS,
  DONATION_KINDS,
  DONATION_MAX_CENTS,
  DONATION_MIN_CENTS,
  DONATION_PRESETS_CENTS,
  type DonationChoice,
  donationBreakdown,
  donationChoiceSchema,
  donationFeeCents,
  donationRefundCents,
  isDonationPreset,
  resolveDonation,
  roundUpDonationCents,
} from "./donations.ts";
import { calculateCharge } from "./fees.ts";

describe("constants (SPEC §15)", () => {
  it("match the agreed checkout options", () => {
    expect(DONATION_PRESETS_CENTS).toEqual([200, 500]);
    expect(DONATION_MIN_CENTS).toBe(100);
    expect(DONATION_MAX_CENTS).toBe(50_000);
    expect(DONATION_CARD_FEE_BPS).toBe(290);
    expect(DONATION_KINDS).toEqual(["none", "round_up", "preset", "custom"]);
  });

  it("recognises presets", () => {
    expect(isDonationPreset(200)).toBe(true);
    expect(isDonationPreset(500)).toBe(true);
    expect(isDonationPreset(100)).toBe(false);
    expect(isDonationPreset("200")).toBe(false);
  });
});

describe("roundUpDonationCents", () => {
  it.each([
    [7321, 79], // SPEC §7 worked example: $73.21 -> $74.00
    [6453, 47],
    [12179, 21],
    [101, 99],
    [199, 1],
    [1, 99],
  ])("rounds %s up by %s", (total, donation) => {
    expect(roundUpDonationCents(total)).toBe(donation);
    expect((total + donation) % 100).toBe(0);
  });

  it.each([7300, 100, 12_000, 0])("offers $1.00 when %s is already whole", (total) => {
    expect(roundUpDonationCents(total)).toBe(100);
  });

  it("always lands on the next whole dollar", () => {
    for (let total = 1; total <= 2000; total++) {
      const donation = roundUpDonationCents(total);
      expect(donation).toBeGreaterThanOrEqual(1);
      expect(donation).toBeLessThanOrEqual(100);
      expect(total + donation).toBe((Math.floor(total / 100) + 1) * 100);
    }
  });

  it.each([-1, 10.5, Number.NaN])("rejects %s", (total) => {
    expect(() => roundUpDonationCents(total)).toThrow(RangeError);
  });
});

describe("donationChoiceSchema", () => {
  it.each<DonationChoice>([
    { kind: "none" },
    { kind: "round_up" },
    { kind: "preset", amountCents: 200 },
    { kind: "preset", amountCents: 500 },
    { kind: "custom", amountCents: 100 },
    { kind: "custom", amountCents: 1234 },
    { kind: "custom", amountCents: 50_000 },
  ])("accepts %o", (choice) => {
    expect(donationChoiceSchema.parse(choice)).toEqual(choice);
  });

  it("strips client-sent amounts where the server computes them", () => {
    expect(donationChoiceSchema.parse({ kind: "round_up", amountCents: 99_999 })).toEqual({
      kind: "round_up",
    });
    expect(donationChoiceSchema.parse({ kind: "none", amountCents: 500 })).toEqual({
      kind: "none",
    });
  });

  it.each([
    [{ kind: "preset", amountCents: 300 }, "Choose $2.00 or $5.00"],
    [{ kind: "preset", amountCents: "200" }, "Choose $2.00 or $5.00"],
    [{ kind: "custom", amountCents: 99 }, "Choose an amount from $1.00 to $500.00"],
    [{ kind: "custom", amountCents: 50_001 }, "Choose an amount from $1.00 to $500.00"],
    [{ kind: "custom", amountCents: 150.5 }, "Amount must be a whole number of cents"],
  ])("rejects %o with %j", (choice, message) => {
    const result = donationChoiceSchema.safeParse(choice);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(message);
  });

  it.each([
    {},
    { kind: "everything" },
    { kind: "custom" },
    { kind: "preset" },
    { kind: "custom", amountCents: -100 },
    { kind: "custom", amountCents: Number.POSITIVE_INFINITY },
    null,
    "none",
  ])("rejects %o", (choice) => {
    expect(donationChoiceSchema.safeParse(choice).success).toBe(false);
  });
});

describe("resolveDonation", () => {
  it("resolves every kind", () => {
    expect(resolveDonation({ kind: "none" }, 7321)).toEqual({ kind: "none", amountCents: 0 });
    expect(resolveDonation({ kind: "round_up" }, 7321)).toEqual({
      kind: "round_up",
      amountCents: 79,
    });
    expect(resolveDonation({ kind: "round_up" }, 7300)).toEqual({
      kind: "round_up",
      amountCents: 100,
    });
    expect(resolveDonation({ kind: "preset", amountCents: 500 }, 7321)).toEqual({
      kind: "preset",
      amountCents: 500,
    });
    expect(resolveDonation({ kind: "custom", amountCents: 2500 }, 7321)).toEqual({
      kind: "custom",
      amountCents: 2500,
    });
  });

  it("resolves a parsed choice", () => {
    const choice = donationChoiceSchema.parse({ kind: "round_up" });
    expect(resolveDonation(choice, 12179).amountCents).toBe(21);
  });

  it("re-checks amounts that bypassed the schema", () => {
    const bad = (choice: unknown) => () => resolveDonation(choice as DonationChoice, 1000);
    expect(bad({ kind: "preset", amountCents: 300 })).toThrow(RangeError);
    expect(bad({ kind: "custom", amountCents: 99 })).toThrow(RangeError);
    expect(bad({ kind: "custom", amountCents: 50_001 })).toThrow(RangeError);
    expect(bad({ kind: "custom", amountCents: 150.5 })).toThrow(RangeError);
    expect(bad({ kind: "mystery" })).toThrow(/unknown donation kind/);
  });

  it("rejects an invalid order total", () => {
    expect(() => resolveDonation({ kind: "none" }, -1)).toThrow(RangeError);
    expect(() => resolveDonation({ kind: "round_up" }, 12.5)).toThrow(RangeError);
  });
});

describe("donationFeeCents / donationBreakdown", () => {
  it("SPEC example: $2.00 -> $0.06 fee -> $1.94 to the fund", () => {
    expect(donationFeeCents(200)).toBe(6); // 5.8
    expect(donationBreakdown(200)).toEqual({ amountCents: 200, feeCents: 6, netCents: 194 });
  });

  it.each([
    [500, 15, 485], // 14.5 -> 15 (half-up)
    [100, 3, 97], // 2.9
    [79, 2, 77], // 2.291
    [17, 0, 17], // 0.493
    [18, 1, 17], // 0.522
    [50_000, 1450, 48_550],
    [0, 0, 0],
  ])("%s -> fee %s, net %s (no fixed fee)", (amount, fee, net) => {
    expect(donationBreakdown(amount)).toEqual({
      amountCents: amount,
      feeCents: fee,
      netCents: net,
    });
  });

  it("always splits the amount exactly", () => {
    for (let amount = 0; amount <= DONATION_MAX_CENTS; amount += 37) {
      const { feeCents, netCents } = donationBreakdown(amount);
      expect(feeCents + netCents).toBe(amount);
      expect(Math.abs(feeCents - amount * 0.029)).toBeLessThanOrEqual(0.5);
    }
  });

  it.each([-1, 1.5, Number.NaN])("rejects %s", (amount) => {
    expect(() => donationFeeCents(amount)).toThrow(RangeError);
    expect(() => donationBreakdown(amount)).toThrow(RangeError);
  });
});

describe("donationRefundCents", () => {
  const paid: PaidAmounts = calculateCharge({
    priceCents: 6000,
    province: "NS",
    businessTaxRegistered: true,
    at: "2026-10-21",
  });
  const start = new Date("2026-11-20T14:00:00Z");

  it("refunds the donation when the booking is refunded in full (business cancellation)", () => {
    expect(donationRefundCents(200, paid, refundForBusinessCancellation(paid))).toBe(200);
  });

  it("keeps the donation when the customer cancels, even for free", () => {
    const refund = refundForCustomerCancellation({
      ...paid,
      policy: "flexible",
      jobStartsAt: start,
      cancelledAt: new Date("2026-11-10T14:00:00Z"),
    });
    expect(refund.isFreeCancellation).toBe(true);
    expect(donationRefundCents(200, paid, refund)).toBe(0); // the service fee is kept
  });

  it("keeps the donation on a partial refund", () => {
    expect(donationRefundCents(500, paid, { totalRefundCents: 3000 })).toBe(0);
    expect(donationRefundCents(500, paid, { totalRefundCents: 7320 })).toBe(0);
    expect(donationRefundCents(500, paid, { totalRefundCents: 7321 })).toBe(500);
  });

  it("rejects invalid amounts", () => {
    expect(() => donationRefundCents(-1, paid, { totalRefundCents: 0 })).toThrow(RangeError);
    expect(() => donationRefundCents(100, paid, { totalRefundCents: 1.5 })).toThrow(RangeError);
    expect(() =>
      donationRefundCents(100, { ...paid, taxOnFeeCents: -1 }, { totalRefundCents: 0 }),
    ).toThrow(/taxOnFeeCents/);
  });
});
