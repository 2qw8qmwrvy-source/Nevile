import { describe, expect, it } from "vitest";
import {
  BUSINESS_FEE_BPS,
  CUSTOMER_PLATFORM_FEE_BPS,
  calculateBusinessFee,
  calculateCharge,
  calculateServiceFee,
  calculateTip,
  DEFAULT_CARD_PROCESSING,
  estimateProcessingCents,
  NO_SALES_TAX,
  PLATFORM_NET_TARGET_BPS,
  serviceFeeTaxRatesFor,
} from "./fees.ts";
import { percentOf } from "./money.ts";
import {
  PROVINCE_CODES,
  type ProvinceCode,
  SALES_TAX_TABLE,
  type SalesTaxTable,
  salesTaxRatesFor,
} from "./tax.ts";

const AT = "2026-10-21";
/** Nova Scotia's HST since 2025-04-01, on both the price and the fee. */
const NS_HST = { onPriceBps: 1400, onFeeBps: 1400 } as const;

const charge = (priceCents: number, province: ProvinceCode = "NS", businessTaxRegistered = true) =>
  calculateCharge({ priceCents, province, businessTaxRegistered, at: AT });

describe("constants", () => {
  it("match SPEC §7", () => {
    expect(BUSINESS_FEE_BPS).toBe(300);
    expect(CUSTOMER_PLATFORM_FEE_BPS).toBe(300);
    expect(PLATFORM_NET_TARGET_BPS).toBe(600);
    expect(DEFAULT_CARD_PROCESSING).toEqual({ rateBps: 290, fixedCents: 30 });
    expect(NO_SALES_TAX).toEqual({ onPriceBps: 0, onFeeBps: 0 });
  });
});

describe("serviceFeeTaxRatesFor", () => {
  it("adds up every component in force", () => {
    expect(serviceFeeTaxRatesFor(salesTaxRatesFor("NS", AT), true)).toEqual(NS_HST);
    expect(serviceFeeTaxRatesFor(salesTaxRatesFor("ON", AT), true)).toEqual({
      onPriceBps: 1300,
      onFeeBps: 1300,
    });
    // Quebec: GST 5% + QST 9.975% = 14.975%.
    expect(serviceFeeTaxRatesFor(salesTaxRatesFor("QC", AT), true)).toEqual({
      onPriceBps: 1497.5,
      onFeeBps: 1497.5,
    });
    // PST is off at launch, so British Columbia is GST only.
    expect(serviceFeeTaxRatesFor(salesTaxRatesFor("BC", AT), true)).toEqual({
      onPriceBps: 500,
      onFeeBps: 500,
    });
  });

  it("charges nothing on the price when the business is not registered", () => {
    expect(serviceFeeTaxRatesFor(salesTaxRatesFor("NS", AT), false)).toEqual({
      onPriceBps: 0,
      onFeeBps: 1400,
    });
  });

  it("follows the dated table (Nova Scotia HST was 15% before 2025-04-01)", () => {
    expect(serviceFeeTaxRatesFor(salesTaxRatesFor("NS", "2025-03-31"), true)).toEqual({
      onPriceBps: 1500,
      onFeeBps: 1500,
    });
  });

  it("is zero when no component applies", () => {
    expect(serviceFeeTaxRatesFor({ components: [] }, true)).toEqual(NO_SALES_TAX);
  });
});

describe("calculateServiceFee", () => {
  it.each([
    [6000, NS_HST, 422], // (180 + 198.36 + 30) / 0.96694 = 422.32…  (SPEC worked example)
    [10000, NS_HST, 683], // 683.19…
    [18000, NS_HST, 1205], // 1204.91…
    [6000, { onPriceBps: 0, onFeeBps: 1400 }, 397], // not registered: 397.13…
    [6000, { onPriceBps: 1300, onFeeBps: 1300 }, 420], // Ontario: 420.40…
  ])("job price %s with %o -> service fee %s (SPEC §7)", (price, rates, fee) => {
    expect(calculateServiceFee(price, rates)).toBe(fee);
  });

  it.each([
    [1, 31], // 31.09…
    [100, 38], // 37.55…
    [2500, 194], // 194.07…
    [10_000_000, 652_191], // $100k: 652 191.45…
  ])("Nova Scotia, registered: job price %s -> service fee %s", (price, fee) => {
    expect(calculateServiceFee(price, NS_HST)).toBe(fee);
  });

  it("without sales tax grosses up only the card fee", () => {
    expect(calculateServiceFee(10000, NO_SALES_TAX)).toBe(639); // 638.52…
    expect(calculateServiceFee(100, NO_SALES_TAX)).toBe(37); // 36.97…
  });

  it("rounds the exact quotient half-up, once", () => {
    // With 0% + $0 processing the fee is exactly 3%: 50 × 3% = 1.5 -> 2.
    const free = { rateBps: 0, fixedCents: 0 };
    expect(calculateServiceFee(50, NS_HST, free)).toBe(2);
    expect(calculateServiceFee(49, NS_HST, free)).toBe(1); // 1.47
    expect(calculateServiceFee(10000, NS_HST, free)).toBe(300);
  });

  it("accepts custom processing pricing", () => {
    // (300 + 0.025 × 1.14 × 10000 + 25) / (1 − 0.025 × 1.14) = 627.90…
    expect(calculateServiceFee(10000, NS_HST, { rateBps: 250, fixedCents: 25 })).toBe(628);
    // Fractional basis points (2.95%): 689.49…
    expect(calculateServiceFee(10000, NS_HST, { rateBps: 295, fixedCents: 30 })).toBe(689);
  });

  it("grows with the tax rate on the price and on the fee", () => {
    const base = calculateServiceFee(10000, NO_SALES_TAX);
    const onFeeOnly = calculateServiceFee(10000, { onPriceBps: 0, onFeeBps: 1400 });
    const both = calculateServiceFee(10000, NS_HST);
    expect(base).toBeLessThan(onFeeOnly);
    expect(onFeeOnly).toBeLessThan(both);
  });

  it.each([0, -100, 10.5, Number.NaN])("rejects job price %s", (price) => {
    expect(() => calculateServiceFee(price, NS_HST)).toThrow(RangeError);
  });

  it("rejects impossible processing pricing", () => {
    expect(() => calculateServiceFee(1000, NS_HST, { rateBps: 10000, fixedCents: 30 })).toThrow(
      RangeError,
    );
    expect(() => calculateServiceFee(1000, NS_HST, { rateBps: -1, fixedCents: 30 })).toThrow(
      RangeError,
    );
    expect(() => calculateServiceFee(1000, NS_HST, { rateBps: 290, fixedCents: -1 })).toThrow(
      RangeError,
    );
    // 90% card rate × (1 + 14% tax) ≥ 100%: nothing left to gross up.
    expect(() => calculateServiceFee(1000, NS_HST, { rateBps: 9000, fixedCents: 30 })).toThrow(
      /gross up/,
    );
  });

  it("rejects invalid tax rates", () => {
    expect(() => calculateServiceFee(1000, { onPriceBps: -1, onFeeBps: 0 })).toThrow(RangeError);
    expect(() => calculateServiceFee(1000, { onPriceBps: 0, onFeeBps: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() => calculateServiceFee(1000, { onPriceBps: 0.001, onFeeBps: 0 })).toThrow(RangeError);
  });
});

describe("calculateBusinessFee / estimateProcessingCents", () => {
  it("takes 3% of the price, half-up", () => {
    expect(calculateBusinessFee(10000)).toBe(300);
    expect(calculateBusinessFee(1050)).toBe(32); // 31.5
    expect(calculateBusinessFee(1016)).toBe(30); // 30.48
    expect(calculateBusinessFee(0)).toBe(0);
  });

  it("estimates processing as rate × amount + fixed", () => {
    expect(estimateProcessingCents(7321)).toBe(242); // 212.31 + 30
    expect(estimateProcessingCents(12179)).toBe(383); // 353.19 + 30
    expect(estimateProcessingCents(0)).toBe(30);
    expect(estimateProcessingCents(1000, { rateBps: 0, fixedCents: 0 })).toBe(0);
  });
});

describe("calculateCharge", () => {
  it("SPEC §7 worked example: $60 in Nova Scotia, registered", () => {
    expect(charge(6000)).toEqual({
      priceCents: 6000,
      serviceFeeCents: 422,
      subtotalCents: 6422,
      taxOnPriceCents: 840,
      taxOnFeeCents: 59,
      taxCents: 899,
      taxLines: [
        {
          kind: "HST",
          label: "HST (14%)",
          rateBps: 1400,
          onPriceCents: 840,
          onFeeCents: 59, // 59.08
          amountCents: 899,
        },
      ],
      taxDate: AT,
      totalCents: 7321,
      businessFeeCents: 180,
      businessPayoutCents: 5820,
      businessTransferCents: 6660, // $58.20 + the $8.40 HST on its own price
      estimatedProcessingCents: 242,
      platformNetCents: 360, // exactly 6%
    });
  });

  it.each([
    // [price, registered, fee, tax on price, tax on fee, total]
    [10000, true, 683, 1400, 96, 12179],
    [18000, true, 1205, 2520, 169, 21894],
    [6000, false, 397, 0, 56, 6453],
    [10000, false, 641, 0, 90, 10731],
  ])(
    "Nova Scotia $%s (registered: %s): fee %s, tax %s + %s, total %s",
    (price, registered, fee, taxOnPrice, taxOnFee, total) => {
      const c = charge(price, "NS", registered);
      expect(c.serviceFeeCents).toBe(fee);
      expect(c.taxOnPriceCents).toBe(taxOnPrice);
      expect(c.taxOnFeeCents).toBe(taxOnFee);
      expect(c.taxCents).toBe(taxOnPrice + taxOnFee);
      expect(c.totalCents).toBe(total);
      expect(c.platformNetCents).toBe(price * 0.06);
    },
  );

  it("SPEC reference values: $60 not registered -> HST on fee $0.56, total $64.53", () => {
    const c = charge(6000, "NS", false);
    expect(c.taxLines).toEqual([
      {
        kind: "HST",
        label: "HST (14%)",
        rateBps: 1400,
        onPriceCents: 0,
        onFeeCents: 56,
        amountCents: 56,
      },
    ]);
    expect(c.businessTransferCents).toBe(5820);
    expect(c.estimatedProcessingCents).toBe(217); // 187.14 + 30
    expect(c.platformNetCents).toBe(360);
  });

  it("$60 in Ontario, registered: fee $4.20, total $72.55", () => {
    const c = charge(6000, "ON");
    expect(c.serviceFeeCents).toBe(420);
    expect(c.taxOnPriceCents).toBe(780);
    expect(c.taxOnFeeCents).toBe(55); // 54.6
    expect(c.totalCents).toBe(7255);
    expect(c.platformNetCents).toBe(360);
  });

  it.each<[ProvinceCode, number, number, number]>([
    // [province, fee, tax, total] for $100, registered
    ["NS", 683, 1496, 12179],
    ["ON", 680, 1388, 12068],
    ["NB", 686, 1603, 12289],
    ["AB", 654, 533, 11187],
    ["BC", 654, 533, 11187], // PST pending review: GST only
    ["QC", 686, 1600, 12286], // GST 500 + 34, QST 998 + 68
  ])("$100 in %s, registered: fee %s, tax %s, total %s", (province, fee, tax, total) => {
    const c = charge(10000, province);
    expect(c.serviceFeeCents).toBe(fee);
    expect(c.taxCents).toBe(tax);
    expect(c.totalCents).toBe(total);
    expect(c.platformNetCents).toBe(600);
  });

  it("itemises Quebec's GST and QST and grosses up for both", () => {
    const c = charge(10000, "QC");
    expect(c.taxLines.map((line) => [line.label, line.onPriceCents, line.onFeeCents])).toEqual([
      ["GST (5%)", 500, 34], // 34.3
      ["QST (9.975%)", 998, 68], // 997.5 -> 998, 68.43 -> 68
    ]);
    expect(c.businessTransferCents).toBe(9700 + 500 + 998);
  });

  it("uses the rate in force on the charge date for both the fee and the tax", () => {
    const before = calculateCharge({
      priceCents: 10000,
      province: "NS",
      businessTaxRegistered: true,
      at: "2025-03-31",
    });
    expect(before.serviceFeeCents).toBe(686); // grossed up for 15%
    expect(before.taxLines[0]?.label).toBe("HST (15%)");
    expect(before.taxCents).toBe(1500 + 103);
    expect(before.taxDate).toBe("2025-03-31");
    expect(before.platformNetCents).toBe(600);
  });

  it("converts an instant to the province's local date", () => {
    // 02:30 UTC on April 1 is still 23:30 on March 31 in Halifax (ADT): the 15% rate.
    const c = calculateCharge({
      priceCents: 10000,
      province: "NS",
      businessTaxRegistered: true,
      at: new Date("2025-04-01T02:30:00Z"),
    });
    expect(c.taxDate).toBe("2025-03-31");
    expect(c.serviceFeeCents).toBe(686);
  });

  it("applies a custom table to the fee as well as the tax", () => {
    const withPst: SalesTaxTable = {
      ...SALES_TAX_TABLE,
      BC: { ...SALES_TAX_TABLE.BC, pstAppliesToHomeServices: true },
    };
    const c = calculateCharge({
      priceCents: 10000,
      province: "BC",
      businessTaxRegistered: true,
      at: AT,
      taxTable: withPst,
    });
    // GST 5% + PST 7% = 12% combined.
    expect(c.serviceFeeCents).toBe(
      calculateServiceFee(10000, { onPriceBps: 1200, onFeeBps: 1200 }),
    );
    expect(c.taxLines.map((line) => line.label)).toEqual(["GST (5%)", "PST (7%)"]);
    expect(c.platformNetCents).toBe(600);
  });

  it("splits every charged cent between the business and Nevile", () => {
    for (const province of PROVINCE_CODES) {
      for (const priceCents of [1, 999, 6000, 18000, 123457, 10_000_000]) {
        for (const businessTaxRegistered of [true, false]) {
          const c = charge(priceCents, province, businessTaxRegistered);
          const nevileGross = c.serviceFeeCents + c.taxOnFeeCents + c.businessFeeCents;
          expect(c.businessTransferCents + nevileGross).toBe(c.totalCents);
          expect(c.totalCents).toBe(c.subtotalCents + c.taxCents);
          expect(c.subtotalCents).toBe(c.priceCents + c.serviceFeeCents);
          expect(c.taxCents).toBe(c.taxLines.reduce((n, line) => n + line.amountCents, 0));
          expect(c.estimatedProcessingCents).toBe(estimateProcessingCents(c.totalCents));
          expect(c.platformNetCents).toBe(
            c.serviceFeeCents + c.businessFeeCents - c.estimatedProcessingCents,
          );
        }
      }
    }
  });

  it("passes custom processing through to the fee and the estimate", () => {
    const c = calculateCharge({
      priceCents: 10000,
      province: "AB",
      businessTaxRegistered: false,
      processing: { rateBps: 0, fixedCents: 0 },
      at: AT,
    });
    expect(c.serviceFeeCents).toBe(300);
    expect(c.taxOnFeeCents).toBe(15);
    expect(c.estimatedProcessingCents).toBe(0);
    expect(c.platformNetCents).toBe(600);
  });

  it("rejects a zero or invalid price before looking anything up", () => {
    expect(() => charge(0)).toThrow(/priceCents/);
    expect(() => charge(-1)).toThrow(RangeError);
    expect(() => charge(99.5)).toThrow(RangeError);
  });

  it("rejects an unknown province or a date before the tax data", () => {
    expect(() => charge(1000, "XX" as ProvinceCode)).toThrow(/unknown province/);
    expect(() =>
      calculateCharge({
        priceCents: 1000,
        province: "NS",
        businessTaxRegistered: true,
        at: "2019-12-31",
      }),
    ).toThrow(/no sales tax data/);
  });
});

describe("platform net property (SPEC §7: 6% of the job price, within ±1¢)", () => {
  /** Deterministic pseudo-random prices up to the $100,000 input cap. */
  function* prices(): Generator<number> {
    for (let price = 1; price <= 3000; price++) yield price;
    let seed = 20261021;
    for (let i = 0; i < 1500; i++) {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      yield 1 + (seed % 10_000_000);
    }
  }

  it("holds for every province, registration status and price", () => {
    let checked = 0;
    let worstExact = 0;
    for (const province of PROVINCE_CODES) {
      for (const businessTaxRegistered of [true, false]) {
        for (const priceCents of prices()) {
          const c = charge(priceCents, province, businessTaxRegistered);
          // In whole cents: Nevile's net vs 6% of the price rounded to the cent.
          const target = percentOf(priceCents, PLATFORM_NET_TARGET_BPS);
          expect(Math.abs(c.platformNetCents - target)).toBeLessThanOrEqual(1);
          worstExact = Math.max(worstExact, Math.abs(c.platformNetCents - priceCents * 0.06));
          checked++;
        }
      }
    }
    expect(checked).toBe(PROVINCE_CODES.length * 2 * 4500);
    // Against the exact (fractional) 6%: the fee, business-fee and processing roundings,
    // plus the processor's 2.9% share of each tax line's rounding.
    expect(worstExact).toBeLessThan(1.1);
  });

  it("is exact for whole-dollar Nova Scotia prices in the SPEC table", () => {
    for (const price of [6000, 10000, 18000]) {
      expect(charge(price).platformNetCents).toBe(price * 0.06);
      expect(charge(price, "NS", false).platformNetCents).toBe(price * 0.06);
    }
  });
});

describe("calculateTip", () => {
  it("gives the business 100% and has Nevile absorb processing", () => {
    expect(calculateTip(1000)).toEqual({
      tipCents: 1000,
      customerPaysCents: 1000,
      businessReceivesCents: 1000,
      platformFeeCents: 0,
      estimatedProcessingCents: 59, // 29 + 30
      platformNetCents: -59,
    });
  });

  it("never reports negative zero", () => {
    const tip = calculateTip(500, { rateBps: 0, fixedCents: 0 });
    expect(Object.is(tip.platformNetCents, 0)).toBe(true);
  });

  it.each([0, -1, 2.5])("rejects tip %s", (tip) => {
    expect(() => calculateTip(tip)).toThrow(RangeError);
  });
});
