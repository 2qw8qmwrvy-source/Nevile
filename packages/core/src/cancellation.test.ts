import { describe, expect, it } from "vitest";
import {
  CANCELLATION_POLICIES,
  CANCELLATION_POLICY_IDS,
  type PaidAmounts,
  freeCancellationDeadline,
  isCancellationPolicyId,
  refundForBusinessCancellation,
  refundForCustomerCancellation,
} from "./cancellation.ts";
import { calculateCharge } from "./fees.ts";

const HOUR = 3_600_000;
const START = new Date("2026-11-20T14:00:00Z");
const before = (ms: number) => new Date(START.getTime() - ms);

/** $100 job in Ontario, registered business (see fees tests). */
const PAID: PaidAmounts = {
  priceCents: 10000,
  serviceFeeCents: 639,
  taxOnPriceCents: 1300,
  taxOnFeeCents: 83,
};

describe("policy presets", () => {
  it("match SPEC §5", () => {
    expect(CANCELLATION_POLICY_IDS).toEqual(["flexible", "moderate", "strict"]);
    expect(CANCELLATION_POLICIES.flexible).toMatchObject({
      freeUntilHoursBefore: 24,
      lateRefundBps: 0,
    });
    expect(CANCELLATION_POLICIES.moderate).toMatchObject({
      freeUntilHoursBefore: 48,
      lateRefundBps: 5000,
    });
    expect(CANCELLATION_POLICIES.strict).toMatchObject({
      freeUntilHoursBefore: 168,
      lateRefundBps: 0,
    });
  });

  it("recognises policy ids", () => {
    expect(isCancellationPolicyId("moderate")).toBe(true);
    expect(isCancellationPolicyId("lenient")).toBe(false);
    expect(isCancellationPolicyId(undefined)).toBe(false);
  });

  it("computes the free-cancellation deadline in elapsed hours", () => {
    expect(freeCancellationDeadline("flexible", START).toISOString()).toBe(
      "2026-11-19T14:00:00.000Z",
    );
    expect(freeCancellationDeadline("moderate", START).toISOString()).toBe(
      "2026-11-18T14:00:00.000Z",
    );
    expect(freeCancellationDeadline("strict", START).toISOString()).toBe(
      "2026-11-13T14:00:00.000Z",
    );
  });

  it("uses 168 elapsed hours for 'strict' even across a DST change", () => {
    // 09:00 EST on 2026-11-04; seven days earlier, 168h back, is 10:00 EDT on 2026-10-28.
    const start = new Date("2026-11-04T14:00:00Z");
    expect(freeCancellationDeadline("strict", start).toISOString()).toBe(
      "2026-10-28T14:00:00.000Z",
    );
  });
});

describe("refundForCustomerCancellation", () => {
  const cancel = (policy: "flexible" | "moderate" | "strict", cancelledAt: Date, paid = PAID) =>
    refundForCustomerCancellation({ ...paid, policy, jobStartsAt: START, cancelledAt });

  it.each([
    ["flexible", 24 * HOUR],
    ["moderate", 48 * HOUR],
    ["strict", 168 * HOUR],
  ] as const)("%s: cancelling exactly at the deadline is free (inclusive)", (policy, ms) => {
    const refund = cancel(policy, before(ms));
    expect(refund.isFreeCancellation).toBe(true);
    expect(refund.priceRefundBps).toBe(10_000);
    expect(refund.priceRefundCents).toBe(10000);
    expect(refund.taxOnPriceRefundCents).toBe(1300);
  });

  it("keeps the service fee and its tax on a free cancellation", () => {
    const refund = cancel("flexible", before(72 * HOUR));
    expect(refund).toEqual({
      priceRefundBps: 10_000,
      isFreeCancellation: true,
      priceRefundCents: 10000,
      taxOnPriceRefundCents: 1300,
      serviceFeeRefundCents: 0,
      taxOnFeeRefundCents: 0,
      totalRefundCents: 11300,
      retainedPriceCents: 0,
      businessFeeCents: 0,
      businessPayoutCents: 0,
      retainedTaxOnPriceCents: 0,
    });
  });

  it("flexible: one millisecond past the deadline refunds nothing", () => {
    const refund = cancel("flexible", before(24 * HOUR - 1));
    expect(refund.isFreeCancellation).toBe(false);
    expect(refund.priceRefundBps).toBe(0);
    expect(refund.totalRefundCents).toBe(0);
    expect(refund.retainedPriceCents).toBe(10000);
    expect(refund.businessFeeCents).toBe(300);
    expect(refund.businessPayoutCents).toBe(9700);
    expect(refund.retainedTaxOnPriceCents).toBe(1300);
  });

  it("moderate: inside 48h refunds 50% of the price and its tax", () => {
    const refund = cancel("moderate", before(47 * HOUR));
    expect(refund).toEqual({
      priceRefundBps: 5000,
      isFreeCancellation: false,
      priceRefundCents: 5000,
      taxOnPriceRefundCents: 650,
      serviceFeeRefundCents: 0,
      taxOnFeeRefundCents: 0,
      totalRefundCents: 5650,
      retainedPriceCents: 5000,
      businessFeeCents: 150,
      businessPayoutCents: 4850,
      retainedTaxOnPriceCents: 650,
    });
  });

  it("moderate: rounds the half refund and proportional tax half-up", () => {
    const paid = { priceCents: 6001, serviceFeeCents: 395, taxOnPriceCents: 780, taxOnFeeCents: 51 };
    const refund = cancel("moderate", before(HOUR), paid);
    expect(refund.priceRefundCents).toBe(3001); // 3000.5 -> 3001
    expect(refund.taxOnPriceRefundCents).toBe(390); // 780 × 3001 / 6001 = 390.06
    expect(refund.retainedPriceCents).toBe(3000);
    expect(refund.retainedTaxOnPriceCents).toBe(390);
    expect(refund.businessFeeCents).toBe(90);
  });

  it("strict: inside 7 days refunds nothing", () => {
    const refund = cancel("strict", before(168 * HOUR - 1));
    expect(refund.totalRefundCents).toBe(0);
    expect(refund.retainedPriceCents).toBe(10000);
  });

  it("applies the late rule after the job has started", () => {
    expect(cancel("moderate", new Date(START.getTime() + HOUR)).priceRefundCents).toBe(5000);
    expect(cancel("flexible", START).priceRefundCents).toBe(0);
  });

  it("refunds no tax when the business charged none", () => {
    const paid = { priceCents: 10000, serviceFeeCents: 639, taxOnPriceCents: 0, taxOnFeeCents: 83 };
    const refund = cancel("moderate", before(HOUR), paid);
    expect(refund.taxOnPriceRefundCents).toBe(0);
    expect(refund.totalRefundCents).toBe(5000);
  });

  it("accepts a ChargeBreakdown directly", () => {
    const charge = calculateCharge({
      priceCents: 18000,
      province: "ON",
      businessTaxRegistered: true,
      at: "2026-10-21",
    });
    const refund = refundForCustomerCancellation({
      ...charge,
      policy: "moderate",
      jobStartsAt: START,
      cancelledAt: before(HOUR),
    });
    expect(refund.priceRefundCents).toBe(9000);
    expect(refund.taxOnPriceRefundCents).toBe(1170);
    expect(refund.totalRefundCents).toBe(10170);
  });

  it("totals always add up", () => {
    for (const priceCents of [1, 333, 6001, 99999]) {
      const paid = {
        priceCents,
        serviceFeeCents: 77,
        taxOnPriceCents: Math.round(priceCents * 0.13),
        taxOnFeeCents: 10,
      };
      const refund = cancel("moderate", before(HOUR), paid);
      expect(refund.totalRefundCents).toBe(
        refund.priceRefundCents +
          refund.taxOnPriceRefundCents +
          refund.serviceFeeRefundCents +
          refund.taxOnFeeRefundCents,
      );
      expect(refund.priceRefundCents + refund.retainedPriceCents).toBe(priceCents);
      expect(refund.taxOnPriceRefundCents + refund.retainedTaxOnPriceCents).toBe(
        paid.taxOnPriceCents,
      );
      expect(refund.businessFeeCents + refund.businessPayoutCents).toBe(refund.retainedPriceCents);
    }
  });

  it("rejects invalid input", () => {
    expect(() => cancel("flexible", new Date(Number.NaN))).toThrow(RangeError);
    expect(() =>
      refundForCustomerCancellation({
        ...PAID,
        priceCents: -1,
        policy: "flexible",
        jobStartsAt: START,
        cancelledAt: START,
      }),
    ).toThrow(/priceCents/);
    expect(() =>
      refundForCustomerCancellation({
        ...PAID,
        policy: "flexible",
        jobStartsAt: new Date("nope"),
        cancelledAt: START,
      }),
    ).toThrow(/jobStartsAt/);
  });
});

describe("refundForBusinessCancellation", () => {
  it("refunds everything, including the service fee and its tax", () => {
    expect(refundForBusinessCancellation(PAID)).toEqual({
      priceRefundBps: 10_000,
      isFreeCancellation: true,
      priceRefundCents: 10000,
      taxOnPriceRefundCents: 1300,
      serviceFeeRefundCents: 639,
      taxOnFeeRefundCents: 83,
      totalRefundCents: 12022,
      retainedPriceCents: 0,
      businessFeeCents: 0,
      businessPayoutCents: 0,
      retainedTaxOnPriceCents: 0,
    });
  });

  it("rejects invalid amounts", () => {
    expect(() => refundForBusinessCancellation({ ...PAID, taxOnFeeCents: 1.2 })).toThrow(
      /taxOnFeeCents/,
    );
  });
});
