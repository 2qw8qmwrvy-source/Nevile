import { describe, expect, it } from "vitest";
import {
  BUSINESS_FEE_BPS,
  CUSTOMER_PLATFORM_FEE_BPS,
  DEFAULT_CARD_PROCESSING,
  calculateBusinessFee,
  calculateCharge,
  calculateServiceFee,
  calculateTip,
  estimateProcessingCents,
} from "./fees.ts";
import type { ProvinceCode } from "./tax.ts";

const AT = "2026-10-21";

describe("constants", () => {
  it("match SPEC §7", () => {
    expect(BUSINESS_FEE_BPS).toBe(300);
    expect(CUSTOMER_PLATFORM_FEE_BPS).toBe(300);
    expect(DEFAULT_CARD_PROCESSING).toEqual({ rateBps: 290, fixedCents: 30 });
  });
});

describe("calculateServiceFee", () => {
  it.each([
    [10000, 639], // SPEC worked example: (100 × 1.03 + 0.30) / 0.971 = 106.3851…
    [6000, 395], // 63.9547…
    [18000, 1125], // 191.2461…
  ])("job price %s -> service fee %s (canonical)", (price, fee) => {
    expect(calculateServiceFee(price)).toBe(fee);
  });

  it.each([
    [1, 31], // (0.0103 + 0.30) / 0.971 = 0.3195… -> 0.32 gross
    [100, 37], // 1.3697… -> 1.37 gross
    [2500, 183], // 26.8280… -> 26.83 gross
    [10_000_000, 607_652], // $100k: 106 076.519… -> 106 076.52 gross
  ])("job price %s -> service fee %s", (price, fee) => {
    expect(calculateServiceFee(price)).toBe(fee);
  });

  it("rounds the grossed-up amount half-up", () => {
    // With 0% + $0 processing the fee is exactly 3%, so 50 cents × 3% = 1.5 -> 2.
    expect(calculateServiceFee(50, { rateBps: 0, fixedCents: 0 })).toBe(2);
    expect(calculateServiceFee(10000, { rateBps: 0, fixedCents: 0 })).toBe(300);
  });

  it("accepts custom processing pricing", () => {
    // (10000 × 1.03 + 25) / 0.975 = 10589.74… -> 10590
    expect(calculateServiceFee(10000, { rateBps: 250, fixedCents: 25 })).toBe(590);
    // Fractional basis points: 2.95% -> (10300 + 30) / 0.9705 = 10643.99… -> 10644
    expect(calculateServiceFee(10000, { rateBps: 295, fixedCents: 30 })).toBe(644);
  });

  it("nets Nevile ≈ 6% of the pre-tax price for every price", () => {
    for (let price = 500; price <= 200_000; price += 137) {
      const fee = calculateServiceFee(price);
      const processingOnPreTax = estimateProcessingCents(price + fee);
      const net = fee + calculateBusinessFee(price) - processingOnPreTax;
      expect(Math.abs(net - price * 0.06)).toBeLessThanOrEqual(1.5);
    }
  });

  it.each([0, -100, 10.5, Number.NaN])("rejects job price %s", (price) => {
    expect(() => calculateServiceFee(price)).toThrow(RangeError);
  });

  it("rejects impossible processing pricing", () => {
    expect(() => calculateServiceFee(1000, { rateBps: 10000, fixedCents: 30 })).toThrow(RangeError);
    expect(() => calculateServiceFee(1000, { rateBps: -1, fixedCents: 30 })).toThrow(RangeError);
    expect(() => calculateServiceFee(1000, { rateBps: 290, fixedCents: -1 })).toThrow(RangeError);
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
    expect(estimateProcessingCents(10639)).toBe(339); // 308.53 + 30
    expect(estimateProcessingCents(12022)).toBe(379); // 348.64 + 30
    expect(estimateProcessingCents(0)).toBe(30);
    expect(estimateProcessingCents(1000, { rateBps: 0, fixedCents: 0 })).toBe(0);
  });
});

describe("calculateCharge", () => {
  const ontario = (priceCents: number, businessTaxRegistered = true) =>
    calculateCharge({ priceCents, province: "ON", businessTaxRegistered, at: AT });

  it("$60 in Ontario, registered: HST $8.31, total $72.26", () => {
    const charge = ontario(6000);
    expect(charge.serviceFeeCents).toBe(395);
    expect(charge.taxOnPriceCents).toBe(780);
    expect(charge.taxOnFeeCents).toBe(51);
    expect(charge.taxCents).toBe(831);
    expect(charge.totalCents).toBe(7226);
  });

  it("$180 in Ontario, registered: HST $24.86, total $216.11", () => {
    const charge = ontario(18000);
    expect(charge.serviceFeeCents).toBe(1125);
    expect(charge.taxCents).toBe(2486);
    expect(charge.totalCents).toBe(21611);
  });

  it("$100 in Ontario, registered: full breakdown", () => {
    expect(ontario(10000)).toEqual({
      priceCents: 10000,
      serviceFeeCents: 639,
      subtotalCents: 10639,
      taxOnPriceCents: 1300,
      taxOnFeeCents: 83,
      taxCents: 1383,
      taxLines: [
        {
          kind: "HST",
          label: "HST (13%)",
          rateBps: 1300,
          onPriceCents: 1300,
          onFeeCents: 83,
          amountCents: 1383,
        },
      ],
      taxDate: AT,
      totalCents: 12022,
      businessFeeCents: 300,
      businessPayoutCents: 9700,
      businessTransferCents: 11000,
      estimatedProcessingCents: 379,
      platformNetCents: 560,
    });
  });

  it("taxes only the service fee when the business is not registered", () => {
    const charge = ontario(10000, false);
    expect(charge.taxOnPriceCents).toBe(0);
    expect(charge.taxOnFeeCents).toBe(83);
    expect(charge.totalCents).toBe(10722);
    expect(charge.businessTransferCents).toBe(9700);
    expect(charge.estimatedProcessingCents).toBe(341); // 310.94 + 30
    expect(charge.platformNetCents).toBe(598);
  });

  it("reports the SPEC pre-tax example honestly once tax is charged", () => {
    // Pre-tax, Nevile nets $6.00 (SPEC table); processing on the tax lowers it.
    const pre = ontario(10000, false);
    expect(pre.serviceFeeCents + pre.businessFeeCents - estimateProcessingCents(pre.subtotalCents)).toBe(
      600,
    );
    expect(ontario(10000).platformNetCents).toBe(560);
  });

  it.each<[ProvinceCode, number, number]>([
    ["AB", 532, 11171], // GST 500 + 31.95 -> 32
    ["NS", 1489, 12128], // HST 14%: 1400 + 89.46 -> 89
    ["NB", 1596, 12235], // HST 15%: 1500 + 95.85 -> 96
    ["QC", 1594, 12233], // GST 532 + QST 998 + 63.74 -> 64
    ["BC", 532, 11171], // PST pending review: GST only
  ])("$100 in %s, registered: tax %s, total %s", (province, tax, total) => {
    const charge = calculateCharge({
      priceCents: 10000,
      province,
      businessTaxRegistered: true,
      at: AT,
    });
    expect(charge.taxCents).toBe(tax);
    expect(charge.totalCents).toBe(total);
  });

  it("splits every charged cent between the business and Nevile", () => {
    for (const province of ["ON", "QC", "AB", "NS"] as const) {
      for (const priceCents of [1, 999, 6000, 18000, 123457, 10_000_000]) {
        for (const businessTaxRegistered of [true, false]) {
          const c = calculateCharge({ priceCents, province, businessTaxRegistered, at: AT });
          const nevileGross = c.serviceFeeCents + c.taxOnFeeCents + c.businessFeeCents;
          expect(c.businessTransferCents + nevileGross).toBe(c.totalCents);
          expect(c.totalCents).toBe(c.subtotalCents + c.taxCents);
          expect(c.taxCents).toBe(c.taxLines.reduce((n, line) => n + line.amountCents, 0));
          expect(c.platformNetCents).toBe(
            c.serviceFeeCents + c.businessFeeCents - c.estimatedProcessingCents,
          );
        }
      }
    }
  });

  it("passes custom processing through to the fee and the estimate", () => {
    const charge = calculateCharge({
      priceCents: 10000,
      province: "AB",
      businessTaxRegistered: false,
      processing: { rateBps: 0, fixedCents: 0 },
      at: AT,
    });
    expect(charge.serviceFeeCents).toBe(300);
    expect(charge.estimatedProcessingCents).toBe(0);
    expect(charge.platformNetCents).toBe(600);
  });

  it("rejects a zero or invalid price", () => {
    expect(() => ontario(0)).toThrow(RangeError);
    expect(() => ontario(-1)).toThrow(RangeError);
    expect(() => ontario(99.5)).toThrow(RangeError);
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
