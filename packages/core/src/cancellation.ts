/**
 * Cancellation policy presets and refund maths — SPEC §5 and §7 "Refunds".
 *
 * | Preset   | Free until            | After that       |
 * |----------|-----------------------|------------------|
 * | flexible | 24 hours before start | no refund        |
 * | moderate | 48 hours before start | 50% refund       |
 * | strict   | 7 days before start   | no refund        |
 *
 * Windows are measured in elapsed time (7 days = 168 hours) and are inclusive: cancelling
 * exactly 24h before the start of a flexible booking is still free.
 *
 * Customer-initiated cancellations never refund the service fee (nor the tax on it).
 * The sales tax on the job price is refunded in proportion to the price refunded.
 * Business-initiated cancellations refund everything, including the service fee.
 */

import { BUSINESS_FEE_BPS } from "./fees.ts";
import { assertCents, bigintToCents, type Cents, divideRoundHalfUp, percentOf } from "./money.ts";
import { assertValidDate, MS_PER_HOUR } from "./time.ts";

export const CANCELLATION_POLICY_IDS = ["flexible", "moderate", "strict"] as const;
export type CancellationPolicyId = (typeof CANCELLATION_POLICY_IDS)[number];

export type CancellationPolicy = {
  id: CancellationPolicyId;
  label: string;
  description: string;
  /** Free cancellation while at least this many hours remain before the start. */
  freeUntilHoursBefore: number;
  /** Share of the job price refunded after the free window, in basis points. */
  lateRefundBps: number;
};

export const CANCELLATION_POLICIES: Readonly<Record<CancellationPolicyId, CancellationPolicy>> = {
  flexible: {
    id: "flexible",
    label: "Flexible",
    description: "Free cancellation until 24 hours before the job.",
    freeUntilHoursBefore: 24,
    lateRefundBps: 0,
  },
  moderate: {
    id: "moderate",
    label: "Moderate",
    description: "Free cancellation until 48 hours before the job; after that, 50% refund.",
    freeUntilHoursBefore: 48,
    lateRefundBps: 5000,
  },
  strict: {
    id: "strict",
    label: "Strict",
    description: "Free cancellation until 7 days before the job; after that, no refund.",
    freeUntilHoursBefore: 7 * 24,
    lateRefundBps: 0,
  },
};

export function isCancellationPolicyId(value: unknown): value is CancellationPolicyId {
  return (
    typeof value === "string" && (CANCELLATION_POLICY_IDS as readonly string[]).includes(value)
  );
}

/** The last instant at which a customer can still cancel for free (inclusive). */
export function freeCancellationDeadline(policy: CancellationPolicyId, jobStartsAt: Date): Date {
  assertValidDate(jobStartsAt, "jobStartsAt");
  return new Date(
    jobStartsAt.getTime() - CANCELLATION_POLICIES[policy].freeUntilHoursBefore * MS_PER_HOUR,
  );
}

/** Amounts the customer paid for one booking/visit (a `ChargeBreakdown` fits). */
export type PaidAmounts = {
  priceCents: Cents;
  serviceFeeCents: Cents;
  taxOnPriceCents: Cents;
  taxOnFeeCents: Cents;
};

export type RefundBreakdown = {
  /** Share of the job price refunded, in basis points (10000 = all of it). */
  priceRefundBps: number;
  isFreeCancellation: boolean;
  priceRefundCents: Cents;
  taxOnPriceRefundCents: Cents;
  serviceFeeRefundCents: Cents;
  taxOnFeeRefundCents: Cents;
  totalRefundCents: Cents;
  /** Job price the business keeps (before its 3% fee). */
  retainedPriceCents: Cents;
  businessFeeCents: Cents;
  businessPayoutCents: Cents;
  /** Sales tax on the retained price, passed to the business with its payout. */
  retainedTaxOnPriceCents: Cents;
};

function assertPaid(paid: PaidAmounts): void {
  assertCents(paid.priceCents, "priceCents");
  assertCents(paid.serviceFeeCents, "serviceFeeCents");
  assertCents(paid.taxOnPriceCents, "taxOnPriceCents");
  assertCents(paid.taxOnFeeCents, "taxOnFeeCents");
}

function proportionalTax(taxCents: Cents, refundedCents: Cents, priceCents: Cents): Cents {
  if (priceCents === 0 || refundedCents === 0) return 0;
  if (refundedCents === priceCents) return taxCents;
  return bigintToCents(
    divideRoundHalfUp(BigInt(taxCents) * BigInt(refundedCents), BigInt(priceCents)),
  );
}

function breakdown(
  paid: PaidAmounts,
  priceRefundBps: number,
  refundServiceFee: boolean,
): RefundBreakdown {
  const priceRefundCents =
    priceRefundBps >= 10_000 ? paid.priceCents : percentOf(paid.priceCents, priceRefundBps);
  const taxOnPriceRefundCents = proportionalTax(
    paid.taxOnPriceCents,
    priceRefundCents,
    paid.priceCents,
  );
  const serviceFeeRefundCents = refundServiceFee ? paid.serviceFeeCents : 0;
  const taxOnFeeRefundCents = refundServiceFee ? paid.taxOnFeeCents : 0;
  const retainedPriceCents = paid.priceCents - priceRefundCents;
  const businessFeeCents = percentOf(retainedPriceCents, BUSINESS_FEE_BPS);
  return {
    priceRefundBps,
    isFreeCancellation: priceRefundBps >= 10_000,
    priceRefundCents,
    taxOnPriceRefundCents,
    serviceFeeRefundCents,
    taxOnFeeRefundCents,
    totalRefundCents:
      priceRefundCents + taxOnPriceRefundCents + serviceFeeRefundCents + taxOnFeeRefundCents,
    retainedPriceCents,
    businessFeeCents,
    businessPayoutCents: retainedPriceCents - businessFeeCents,
    retainedTaxOnPriceCents: paid.taxOnPriceCents - taxOnPriceRefundCents,
  };
}

export type CustomerCancellationInput = PaidAmounts & {
  policy: CancellationPolicyId;
  jobStartsAt: Date;
  cancelledAt: Date;
};

/**
 * Refund owed when the customer cancels. Cancelling after the start time is treated like
 * any other late cancellation (the booking lifecycle decides whether it is still allowed).
 */
export function refundForCustomerCancellation(input: CustomerCancellationInput): RefundBreakdown {
  assertPaid(input);
  assertValidDate(input.cancelledAt, "cancelledAt");
  const deadline = freeCancellationDeadline(input.policy, input.jobStartsAt);
  const isFree = input.cancelledAt.getTime() <= deadline.getTime();
  const refundBps = isFree ? 10_000 : CANCELLATION_POLICIES[input.policy].lateRefundBps;
  return breakdown(input, refundBps, false);
}

/** Refund owed when the business cancels: everything, including the service fee. */
export function refundForBusinessCancellation(paid: PaidAmounts): RefundBreakdown {
  assertPaid(paid);
  return breakdown(paid, 10_000, true);
}
