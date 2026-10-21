/**
 * Fee model — SPEC §7 "Fee model".
 *
 * - The business pays 3% of the job price, deducted from its payout.
 * - The customer pays a single "Service fee" = 3% + the card processing cost, so that
 *   Nevile nets about 6% of the job price:
 *
 *       grossBeforeTax = round((P × 1.03 + fixed) / (1 − rate))
 *       serviceFee     = grossBeforeTax − P
 *
 *   computed exactly in integer arithmetic and rounded half-up to the cent.
 *
 * The formula follows the SPEC and grosses up the *pre-tax* amount. The processor also
 * charges its percentage on the sales tax collected, so the real processing cost is a
 * little higher than the fee covers; `estimatedProcessingCents` is computed on the full
 * charged total so `platformNetCents` reports Nevile's margin honestly.
 */
import {
  assertCents,
  basisPointsToPpm,
  bigintToCents,
  type Cents,
  divideRoundHalfUp,
  percentOf,
} from "./money.ts";
import { calculateSalesTax, type ProvinceCode, type SalesTaxTable, type TaxLine } from "./tax.ts";

/** Deducted from the business's payout. */
export const BUSINESS_FEE_BPS = 300;
/** Nevile's share of the customer service fee, before processing is grossed up. */
export const CUSTOMER_PLATFORM_FEE_BPS = 300;

export type CardProcessing = {
  /** Percentage part of the processor's fee, in basis points (2.9% = 290). */
  rateBps: number;
  /** Fixed part of the processor's fee per charge. */
  fixedCents: Cents;
};

/** Stripe's standard Canadian card pricing: 2.9% + $0.30. */
export const DEFAULT_CARD_PROCESSING: Readonly<CardProcessing> = { rateBps: 290, fixedCents: 30 };

const PPM = 1_000_000n;

function assertProcessing(processing: CardProcessing): void {
  assertCents(processing.fixedCents, "processing.fixedCents");
  if (basisPointsToPpm(processing.rateBps) >= PPM) {
    throw new RangeError("processing.rateBps must be below 10000 (100%)");
  }
}

function assertPositivePrice(priceCents: number, name: string): void {
  assertCents(priceCents, name);
  if (priceCents === 0) throw new RangeError(`${name} must be greater than zero`);
}

/** The customer service fee for a job price (pre-tax), per the SPEC formula. */
export function calculateServiceFee(
  priceCents: Cents,
  processing: CardProcessing = DEFAULT_CARD_PROCESSING,
): Cents {
  assertPositivePrice(priceCents, "priceCents");
  assertProcessing(processing);
  const platformPpm = basisPointsToPpm(CUSTOMER_PLATFORM_FEE_BPS);
  const ratePpm = basisPointsToPpm(processing.rateBps);
  // (P × (1 + platform) + fixed) / (1 − rate), everything scaled by 1e6 to stay exact.
  const numerator = BigInt(priceCents) * (PPM + platformPpm) + BigInt(processing.fixedCents) * PPM;
  const grossBeforeTax = bigintToCents(divideRoundHalfUp(numerator, PPM - ratePpm));
  return grossBeforeTax - priceCents;
}

/** What the processor is expected to charge on a single charge of `amountCents`. */
export function estimateProcessingCents(
  amountCents: Cents,
  processing: CardProcessing = DEFAULT_CARD_PROCESSING,
): Cents {
  assertCents(amountCents, "amountCents");
  assertProcessing(processing);
  return percentOf(amountCents, processing.rateBps) + processing.fixedCents;
}

/** The 3% business fee on a job price, rounded half-up. */
export function calculateBusinessFee(priceCents: Cents): Cents {
  assertCents(priceCents, "priceCents");
  return percentOf(priceCents, BUSINESS_FEE_BPS);
}

export type ChargeInput = {
  /** The business's price for the job (pre-tax). */
  priceCents: Cents;
  /** Province of the job address. */
  province: ProvinceCode;
  /** Business has entered a GST/HST registration number. */
  businessTaxRegistered: boolean;
  processing?: CardProcessing;
  /** Date the charge is made, for the tax-rate lookup. Defaults to now. */
  at?: Date | string;
  taxTable?: SalesTaxTable;
};

export type ChargeBreakdown = {
  priceCents: Cents;
  serviceFeeCents: Cents;
  /** priceCents + serviceFeeCents: what the customer pays before tax. */
  subtotalCents: Cents;
  taxOnPriceCents: Cents;
  taxOnFeeCents: Cents;
  taxCents: Cents;
  taxLines: TaxLine[];
  /** Local date the tax rates were looked up for. */
  taxDate: string;
  /** What the customer's card is charged. */
  totalCents: Cents;
  businessFeeCents: Cents;
  /** Job price minus the 3% business fee (SPEC: "Business receives"). */
  businessPayoutCents: Cents;
  /**
   * Amount to transfer to the business: payout plus the sales tax charged on its own
   * price, which belongs to the business as the supplier that remits it.
   */
  businessTransferCents: Cents;
  /** Estimated processor fee on the full charged total (including tax). */
  estimatedProcessingCents: Cents;
  /**
   * Service fee + business fee − estimated processing. Tax on the fee is remitted, not
   * revenue, so it is excluded. Slightly under 6% because processing is also charged on tax.
   */
  platformNetCents: number;
};

export function calculateCharge(input: ChargeInput): ChargeBreakdown {
  const processing = input.processing ?? DEFAULT_CARD_PROCESSING;
  const { priceCents } = input;
  const serviceFeeCents = calculateServiceFee(priceCents, processing);
  const tax = calculateSalesTax({
    province: input.province,
    at: input.at,
    priceCents,
    serviceFeeCents,
    businessTaxRegistered: input.businessTaxRegistered,
    table: input.taxTable,
  });
  const subtotalCents = priceCents + serviceFeeCents;
  const totalCents = subtotalCents + tax.totalTaxCents;
  const businessFeeCents = calculateBusinessFee(priceCents);
  const businessPayoutCents = priceCents - businessFeeCents;
  const estimatedProcessingCents = estimateProcessingCents(totalCents, processing);
  assertCents(totalCents, "totalCents");
  return {
    priceCents,
    serviceFeeCents,
    subtotalCents,
    taxOnPriceCents: tax.taxOnPriceCents,
    taxOnFeeCents: tax.taxOnFeeCents,
    taxCents: tax.totalTaxCents,
    taxLines: tax.lines,
    taxDate: tax.taxDate,
    totalCents,
    businessFeeCents,
    businessPayoutCents,
    businessTransferCents: businessPayoutCents + tax.taxOnPriceCents,
    estimatedProcessingCents,
    platformNetCents: serviceFeeCents + businessFeeCents - estimatedProcessingCents,
  };
}

export type TipBreakdown = {
  tipCents: Cents;
  /** The customer is charged exactly the tip: no service fee and no sales tax. */
  customerPaysCents: Cents;
  /** 100% of the tip goes to the business. */
  businessReceivesCents: Cents;
  platformFeeCents: 0;
  /** Processing cost of the separate tip charge, absorbed by Nevile. */
  estimatedProcessingCents: Cents;
  /** Always ≤ 0: the absorbed processing cost. */
  platformNetCents: number;
};

/**
 * A tip after completion (SPEC §7 "Tips"): the business receives 100% and Nevile absorbs
 * the processing cost of the separate charge. Voluntary tips are not subject to GST/HST.
 */
export function calculateTip(
  tipCents: Cents,
  processing: CardProcessing = DEFAULT_CARD_PROCESSING,
): TipBreakdown {
  assertPositivePrice(tipCents, "tipCents");
  const estimatedProcessingCents = estimateProcessingCents(tipCents, processing);
  return {
    tipCents,
    customerPaysCents: tipCents,
    businessReceivesCents: tipCents,
    platformFeeCents: 0,
    estimatedProcessingCents,
    platformNetCents: estimatedProcessingCents === 0 ? 0 : -estimatedProcessingCents,
  };
}
