/**
 * Fee model — SPEC §7 "Fee model".
 *
 * - The business pays 3% of the job price, deducted from its payout.
 * - The customer pays a single "Service fee" sized so that, after the card processor's
 *   cut of the *whole* charge (job price + service fee + sales tax on both), Nevile nets
 *   exactly 6% of the job price:
 *
 *       serviceFee = (0.03·P + r·(1 + tP)·P + f) / (1 − r·(1 + tF))
 *
 *   with card rate r, fixed card fee f, job price P, combined sales-tax rate tP on the job
 *   price (0 when the business is not GST/HST-registered) and tF on the service fee.
 *   It is computed exactly in integer arithmetic and rounded half-up to the cent once.
 *
 * The only deviation from 6% comes from rounding each amount to the cent (the fee, the
 * business fee, each tax line and the processor's percentage): in whole cents the platform
 * net stays within ±1¢ of 6% of P (property-tested for every province).
 */
import {
  assertCents,
  basisPointsToPpm,
  bigintToCents,
  type Cents,
  divideRoundHalfUp,
  percentOf,
} from "./money.ts";
import {
  calculateSalesTax,
  type ProvinceCode,
  type SalesTaxRates,
  type SalesTaxTable,
  salesTaxRatesFor,
  type TaxLine,
} from "./tax.ts";

/** Deducted from the business's payout. */
export const BUSINESS_FEE_BPS = 300;
/** Nevile's share of the customer service fee (the `0.03·P` term of the formula). */
export const CUSTOMER_PLATFORM_FEE_BPS = 300;
/** What Nevile nets per job after card processing: business fee + customer share. */
export const PLATFORM_NET_TARGET_BPS = BUSINESS_FEE_BPS + CUSTOMER_PLATFORM_FEE_BPS;

export type CardProcessing = {
  /** Percentage part of the processor's fee, in basis points (2.9% = 290). */
  rateBps: number;
  /** Fixed part of the processor's fee per charge. */
  fixedCents: Cents;
};

/** Stripe's standard Canadian card pricing: 2.9% + $0.30. */
export const DEFAULT_CARD_PROCESSING: Readonly<CardProcessing> = { rateBps: 290, fixedCents: 30 };

/** Combined sales-tax rates (all applicable components added up), in basis points. */
export type ServiceFeeTaxRates = {
  /** Rate charged on the job price; 0 when the business is not GST/HST-registered. */
  onPriceBps: number;
  /** Rate charged on Nevile's service fee (always charged). */
  onFeeBps: number;
};

/** For a supply on which no sales tax is charged at all. */
export const NO_SALES_TAX: Readonly<ServiceFeeTaxRates> = { onPriceBps: 0, onFeeBps: 0 };

const PPM = 1_000_000n;
const PPM_SQUARED = PPM * PPM;

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

/**
 * Combined rates for the fee formula from a rate lookup: every component in force is
 * added up (Quebec: GST 5% + QST 9.975% = 14.975%). Tax on the job price applies only
 * when the business is GST/HST-registered.
 */
export function serviceFeeTaxRatesFor(
  rates: Pick<SalesTaxRates, "components">,
  businessTaxRegistered: boolean,
): ServiceFeeTaxRates {
  let combinedPpm = 0n;
  for (const component of rates.components) combinedPpm += basisPointsToPpm(component.rateBps);
  // ppm / 100 is exact to two decimals of a basis point, which basisPointsToPpm accepts.
  const onFeeBps = Number(combinedPpm) / 100;
  return { onPriceBps: businessTaxRegistered ? onFeeBps : 0, onFeeBps };
}

/**
 * The customer service fee for a job price (pre-tax), per the SPEC formula. `taxRates`
 * are the combined sales-tax rates charged on the price and on the fee.
 */
export function calculateServiceFee(
  priceCents: Cents,
  taxRates: ServiceFeeTaxRates,
  processing: CardProcessing = DEFAULT_CARD_PROCESSING,
): Cents {
  assertPositivePrice(priceCents, "priceCents");
  assertProcessing(processing);
  const platform = basisPointsToPpm(CUSTOMER_PLATFORM_FEE_BPS);
  const rate = basisPointsToPpm(processing.rateBps);
  const taxOnPrice = basisPointsToPpm(taxRates.onPriceBps);
  const taxOnFee = basisPointsToPpm(taxRates.onFeeBps);
  const price = BigInt(priceCents);
  // Numerator and denominator are both scaled by 1e12 (ppm × ppm) so the quotient is exact
  // before its single half-up rounding.
  const numerator =
    platform * price * PPM +
    rate * (PPM + taxOnPrice) * price +
    BigInt(processing.fixedCents) * PPM_SQUARED;
  const denominator = PPM_SQUARED - rate * (PPM + taxOnFee);
  if (denominator <= 0n) {
    throw new RangeError("processing rate and tax on the fee leave nothing to gross up");
  }
  return bigintToCents(divideRoundHalfUp(numerator, denominator));
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
   * revenue, so it is excluded. 6% of the job price, give or take rounding.
   */
  platformNetCents: number;
};

export function calculateCharge(input: ChargeInput): ChargeBreakdown {
  const processing = input.processing ?? DEFAULT_CARD_PROCESSING;
  const { priceCents } = input;
  assertPositivePrice(priceCents, "priceCents");
  // One rate lookup sizes the fee and taxes the charge, so both use the same date.
  const rates = salesTaxRatesFor(input.province, input.at ?? new Date(), input.taxTable);
  const serviceFeeCents = calculateServiceFee(
    priceCents,
    serviceFeeTaxRatesFor(rates, input.businessTaxRegistered),
    processing,
  );
  const tax = calculateSalesTax({
    province: input.province,
    at: rates.taxDate,
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
