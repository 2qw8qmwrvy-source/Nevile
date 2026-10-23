/**
 * Community donations at checkout — SPEC §15 (Nevile Neighbours) and §7.
 *
 * - Optional and never pre-selected: round up to the next dollar (a whole-dollar total
 *   rounds up by $1), a $2 / $5 preset, or a custom amount from $1 to $500.
 * - Separate from the job price and the service fee: no sales tax, never Nevile revenue.
 * - The card fee is deducted from the donation: 2.9% of the donated amount, rounded
 *   half-up, with no fixed fee because the donation rides on the booking's card charge.
 * - A donation is refunded only when its booking is refunded in full.
 */
import { z } from "zod";
import type { PaidAmounts, RefundBreakdown } from "./cancellation.ts";
import { assertCents, type Cents, formatCad, percentOf } from "./money.ts";

export const DONATION_PRESETS_CENTS = [200, 500] as const;
export type DonationPresetCents = (typeof DONATION_PRESETS_CENTS)[number];

/** Bounds of a custom donation: $1.00 to $500.00. */
export const DONATION_MIN_CENTS = 100;
export const DONATION_MAX_CENTS = 50_000;

/** Card fee deducted from a donation (percentage only; no fixed part). */
export const DONATION_CARD_FEE_BPS = 290;

export const DONATION_KINDS = ["none", "round_up", "preset", "custom"] as const;
export type DonationKind = (typeof DONATION_KINDS)[number];

export function isDonationPreset(value: unknown): value is DonationPresetCents {
  return typeof value === "number" && (DONATION_PRESETS_CENTS as readonly number[]).includes(value);
}

/**
 * The round-up donation for an order total: up to the next whole dollar, or $1.00 when
 * the total is already a whole number of dollars.
 */
export function roundUpDonationCents(totalCents: Cents): Cents {
  assertCents(totalCents, "totalCents");
  const remainder = totalCents % 100;
  return remainder === 0 ? 100 : 100 - remainder;
}

const customAmountMessage = `Choose an amount from ${formatCad(DONATION_MIN_CENTS)} to ${formatCad(DONATION_MAX_CENTS)}`;

/** What the customer picked at checkout. Round-up amounts are computed on the server. */
export const donationChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("round_up") }),
  z.object({
    kind: z.literal("preset"),
    amountCents: z.literal(DONATION_PRESETS_CENTS, {
      message: `Choose ${DONATION_PRESETS_CENTS.map((amount) => formatCad(amount)).join(" or ")}`,
    }),
  }),
  z.object({
    kind: z.literal("custom"),
    amountCents: z
      .number()
      .int({ message: "Amount must be a whole number of cents" })
      .min(DONATION_MIN_CENTS, { message: customAmountMessage })
      .max(DONATION_MAX_CENTS, { message: customAmountMessage }),
  }),
]);
export type DonationChoice = z.infer<typeof donationChoiceSchema>;

export type ResolvedDonation = {
  kind: DonationKind;
  /** 0 for "none". */
  amountCents: Cents;
};

/**
 * The donation amount for a checkout choice. `orderTotalCents` is what the card is charged
 * for the booking itself (job price + service fee + sales tax), before the donation.
 */
export function resolveDonation(choice: DonationChoice, orderTotalCents: Cents): ResolvedDonation {
  assertCents(orderTotalCents, "orderTotalCents");
  switch (choice.kind) {
    case "none":
      return { kind: "none", amountCents: 0 };
    case "round_up":
      return { kind: "round_up", amountCents: roundUpDonationCents(orderTotalCents) };
    case "preset":
      if (!isDonationPreset(choice.amountCents)) {
        throw new RangeError(`not a donation preset: ${String(choice.amountCents)}`);
      }
      return { kind: "preset", amountCents: choice.amountCents };
    case "custom": {
      const amount = choice.amountCents;
      assertCents(amount, "amountCents");
      if (amount < DONATION_MIN_CENTS || amount > DONATION_MAX_CENTS) {
        throw new RangeError(
          `custom donation must be ${DONATION_MIN_CENTS}–${DONATION_MAX_CENTS} cents, got ${amount}`,
        );
      }
      return { kind: "custom", amountCents: amount };
    }
    default:
      throw new RangeError("unknown donation kind");
  }
}

/** Card fee deducted from a donation: 2.9% of the amount, rounded half-up. */
export function donationFeeCents(amountCents: Cents): Cents {
  return percentOf(amountCents, DONATION_CARD_FEE_BPS);
}

export type DonationBreakdown = {
  amountCents: Cents;
  feeCents: Cents;
  /** What reaches the fund. */
  netCents: Cents;
};

/** e.g. $2.00 → $0.06 fee → $1.94 to the fund. */
export function donationBreakdown(amountCents: Cents): DonationBreakdown {
  const feeCents = donationFeeCents(amountCents);
  return { amountCents, feeCents, netCents: amountCents - feeCents };
}

/**
 * The donation to refund when its booking is refunded: all of it if the booking was
 * refunded in full (price, service fee and all tax — a business cancellation or a full
 * admin refund), otherwise nothing.
 */
export function donationRefundCents(
  donationCents: Cents,
  paid: PaidAmounts,
  refund: Pick<RefundBreakdown, "totalRefundCents">,
): Cents {
  assertCents(donationCents, "donationCents");
  assertCents(refund.totalRefundCents, "totalRefundCents");
  let paidCents = 0;
  for (const key of [
    "priceCents",
    "serviceFeeCents",
    "taxOnPriceCents",
    "taxOnFeeCents",
  ] as const) {
    assertCents(paid[key], key);
    paidCents += paid[key];
  }
  return refund.totalRefundCents >= paidCents ? donationCents : 0;
}
