/**
 * Canadian sales tax (GST / HST / PST / QST) as dated data. SPEC §7 "Sales tax".
 *
 * Rules:
 * - Tax on the job price applies only when the business is GST/HST-registered
 *   (small suppliers under the threshold charge none).
 * - Tax on Nevile's service fee always applies.
 * - The province is the job address's province (the place of supply for home services).
 * - Each tax line is computed separately on the price and on the fee (two different
 *   suppliers) and each amount is rounded half-up to the cent.
 */
import { type Cents, assertCents, formatBasisPoints, percentOf } from "./money.ts";
import { isIsoDate, localDateString } from "./time.ts";

export const PROVINCE_CODES = [
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
] as const;

export type ProvinceCode = (typeof PROVINCE_CODES)[number];

export function isProvinceCode(value: unknown): value is ProvinceCode {
  return typeof value === "string" && (PROVINCE_CODES as readonly string[]).includes(value);
}

export type ProvinceInfo = {
  name: string;
  /** Zone used to turn an instant into the local calendar date for rate lookups. */
  timeZone: string;
};

export const PROVINCES: Readonly<Record<ProvinceCode, ProvinceInfo>> = {
  AB: { name: "Alberta", timeZone: "America/Edmonton" },
  BC: { name: "British Columbia", timeZone: "America/Vancouver" },
  MB: { name: "Manitoba", timeZone: "America/Winnipeg" },
  NB: { name: "New Brunswick", timeZone: "America/Moncton" },
  NL: { name: "Newfoundland and Labrador", timeZone: "America/St_Johns" },
  NS: { name: "Nova Scotia", timeZone: "America/Halifax" },
  NT: { name: "Northwest Territories", timeZone: "America/Yellowknife" },
  NU: { name: "Nunavut", timeZone: "America/Iqaluit" },
  ON: { name: "Ontario", timeZone: "America/Toronto" },
  PE: { name: "Prince Edward Island", timeZone: "America/Halifax" },
  QC: { name: "Quebec", timeZone: "America/Toronto" },
  SK: { name: "Saskatchewan", timeZone: "America/Regina" },
  YT: { name: "Yukon", timeZone: "America/Whitehorse" },
};

export const SALES_TAX_KINDS = ["GST", "HST", "PST", "QST"] as const;
export type SalesTaxKind = (typeof SALES_TAX_KINDS)[number];

export type SalesTaxComponent = {
  kind: SalesTaxKind;
  /** Display name; usually equal to `kind` (Manitoba calls its PST "RST"). */
  name: string;
  rateBps: number;
};

export type SalesTaxPeriod = {
  /** First local calendar day (YYYY-MM-DD, inclusive) on which these rates apply. */
  effectiveFrom: string;
  components: readonly SalesTaxComponent[];
};

export type ProvinceSalesTax = {
  /** Sorted by `effectiveFrom` ascending; each period ends when the next one starts. */
  periods: readonly SalesTaxPeriod[];
  /**
   * Whether provincial sales tax is charged on residential home services (and on
   * Nevile's fee for them). PST applicability to these services varies by province and
   * service type, so it is off by default — pending accountant review (SPEC §7 sales tax).
   */
  pstAppliesToHomeServices: boolean;
};

export type SalesTaxTable = Readonly<Record<ProvinceCode, ProvinceSalesTax>>;

/** Earliest date the bundled table covers; lookups before it throw. */
export const SALES_TAX_DATA_FROM = "2020-01-01";

const gst: SalesTaxComponent = { kind: "GST", name: "GST", rateBps: 500 };
const hst = (rateBps: number): SalesTaxComponent => ({ kind: "HST", name: "HST", rateBps });
const pst = (rateBps: number, name = "PST"): SalesTaxComponent => ({ kind: "PST", name, rateBps });
const gstOnly: ProvinceSalesTax = {
  periods: [{ effectiveFrom: SALES_TAX_DATA_FROM, components: [gst] }],
  pstAppliesToHomeServices: false,
};
const hstOnly = (rateBps: number): ProvinceSalesTax => ({
  periods: [{ effectiveFrom: SALES_TAX_DATA_FROM, components: [hst(rateBps)] }],
  pstAppliesToHomeServices: false,
});

export const SALES_TAX_TABLE: SalesTaxTable = {
  AB: gstOnly,
  NT: gstOnly,
  NU: gstOnly,
  YT: gstOnly,
  ON: hstOnly(1300),
  NB: hstOnly(1500),
  NL: hstOnly(1500),
  PE: hstOnly(1500),
  NS: {
    periods: [
      { effectiveFrom: SALES_TAX_DATA_FROM, components: [hst(1500)] },
      { effectiveFrom: "2025-04-01", components: [hst(1400)] },
    ],
    pstAppliesToHomeServices: false,
  },
  QC: {
    periods: [
      {
        effectiveFrom: SALES_TAX_DATA_FROM,
        components: [gst, { kind: "QST", name: "QST", rateBps: 997.5 }],
      },
    ],
    // QST is a broad-based value-added tax that applies to services; not gated.
    pstAppliesToHomeServices: false,
  },
  BC: {
    periods: [{ effectiveFrom: SALES_TAX_DATA_FROM, components: [gst, pst(700)] }],
    pstAppliesToHomeServices: false,
  },
  MB: {
    periods: [{ effectiveFrom: SALES_TAX_DATA_FROM, components: [gst, pst(700, "RST")] }],
    pstAppliesToHomeServices: false,
  },
  SK: {
    periods: [{ effectiveFrom: SALES_TAX_DATA_FROM, components: [gst, pst(600)] }],
    pstAppliesToHomeServices: false,
  },
};

function toTaxDate(province: ProvinceCode, at: Date | string): string {
  if (typeof at === "string") {
    if (!isIsoDate(at)) throw new RangeError(`expected a YYYY-MM-DD date, got "${at}"`);
    return at;
  }
  return localDateString(at, PROVINCES[province].timeZone);
}

export type SalesTaxRates = {
  province: ProvinceCode;
  /** Local date the lookup was made for. */
  taxDate: string;
  effectiveFrom: string;
  /** Components that apply to home services (PST removed unless enabled). */
  components: readonly SalesTaxComponent[];
};

/**
 * Rates in force in `province` on `at`. A `Date` is converted to the province's local
 * calendar date; a string must already be a YYYY-MM-DD local date.
 */
export function salesTaxRatesFor(
  province: ProvinceCode,
  at: Date | string,
  table: SalesTaxTable = SALES_TAX_TABLE,
): SalesTaxRates {
  if (!isProvinceCode(province)) throw new RangeError(`unknown province "${String(province)}"`);
  const config = table[province];
  const taxDate = toTaxDate(province, at);
  let period: SalesTaxPeriod | undefined;
  for (const candidate of config.periods) {
    if (candidate.effectiveFrom <= taxDate) period = candidate;
  }
  if (!period) {
    throw new RangeError(`no sales tax data for ${province} on ${taxDate}`);
  }
  const components = period.components.filter(
    (component) => component.kind !== "PST" || config.pstAppliesToHomeServices,
  );
  return { province, taxDate, effectiveFrom: period.effectiveFrom, components };
}

export type TaxLine = {
  kind: SalesTaxKind;
  /** e.g. "HST (13%)", "QST (9.975%)". */
  label: string;
  rateBps: number;
  /** Tax on the business's job price (0 when the business is not registered). */
  onPriceCents: Cents;
  /** Tax on Nevile's service fee. */
  onFeeCents: Cents;
  amountCents: Cents;
};

export type SalesTaxInput = {
  province: ProvinceCode;
  /** When the supply is taxed (the charge date). Defaults to now. */
  at?: Date | string;
  priceCents: Cents;
  serviceFeeCents: Cents;
  /** Business has entered a GST/HST registration number. */
  businessTaxRegistered: boolean;
  table?: SalesTaxTable;
};

export type SalesTaxResult = {
  province: ProvinceCode;
  taxDate: string;
  /** Lines with a non-zero amount, in the table's component order. */
  lines: TaxLine[];
  taxOnPriceCents: Cents;
  taxOnFeeCents: Cents;
  totalTaxCents: Cents;
};

export function taxLabel(component: SalesTaxComponent): string {
  return `${component.name} (${formatBasisPoints(component.rateBps)})`;
}

export function calculateSalesTax(input: SalesTaxInput): SalesTaxResult {
  assertCents(input.priceCents, "priceCents");
  assertCents(input.serviceFeeCents, "serviceFeeCents");
  const rates = salesTaxRatesFor(input.province, input.at ?? new Date(), input.table);
  const lines: TaxLine[] = [];
  let taxOnPriceCents = 0;
  let taxOnFeeCents = 0;
  for (const component of rates.components) {
    const onPriceCents = input.businessTaxRegistered
      ? percentOf(input.priceCents, component.rateBps)
      : 0;
    const onFeeCents = percentOf(input.serviceFeeCents, component.rateBps);
    taxOnPriceCents += onPriceCents;
    taxOnFeeCents += onFeeCents;
    const amountCents = onPriceCents + onFeeCents;
    if (amountCents > 0) {
      lines.push({
        kind: component.kind,
        label: taxLabel(component),
        rateBps: component.rateBps,
        onPriceCents,
        onFeeCents,
        amountCents,
      });
    }
  }
  return {
    province: rates.province,
    taxDate: rates.taxDate,
    lines,
    taxOnPriceCents,
    taxOnFeeCents,
    totalTaxCents: taxOnPriceCents + taxOnFeeCents,
  };
}
