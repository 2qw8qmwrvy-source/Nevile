import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateSalesTax,
  isProvinceCode,
  PROVINCE_CODES,
  PROVINCES,
  type ProvinceCode,
  SALES_TAX_DATA_FROM,
  SALES_TAX_TABLE,
  type SalesTaxTable,
  salesTaxRatesFor,
} from "./tax.ts";
import { isIsoDate, isValidTimeZone } from "./time.ts";

const TODAY = "2026-10-21";

const withPstEnabled: SalesTaxTable = {
  ...SALES_TAX_TABLE,
  BC: { ...SALES_TAX_TABLE.BC, pstAppliesToHomeServices: true },
  MB: { ...SALES_TAX_TABLE.MB, pstAppliesToHomeServices: true },
  SK: { ...SALES_TAX_TABLE.SK, pstAppliesToHomeServices: true },
};

describe("rate table data", () => {
  it("covers all 13 provinces and territories", () => {
    expect(PROVINCE_CODES).toHaveLength(13);
    expect(Object.keys(SALES_TAX_TABLE).sort()).toEqual([...PROVINCE_CODES].sort());
    expect(Object.keys(PROVINCES).sort()).toEqual([...PROVINCE_CODES].sort());
  });

  it.each(PROVINCE_CODES)("%s has well-formed periods and a valid zone", (code) => {
    expect(isValidTimeZone(PROVINCES[code].timeZone)).toBe(true);
    const { periods } = SALES_TAX_TABLE[code];
    expect(periods[0]?.effectiveFrom).toBe(SALES_TAX_DATA_FROM);
    for (const [index, period] of periods.entries()) {
      expect(isIsoDate(period.effectiveFrom)).toBe(true);
      expect(period.components.length).toBeGreaterThan(0);
      const previous = periods[index - 1];
      if (previous) expect(period.effectiveFrom > previous.effectiveFrom).toBe(true);
    }
  });

  it("keeps PST off for home services pending accountant review", () => {
    for (const code of ["BC", "MB", "SK"] as const) {
      expect(SALES_TAX_TABLE[code].pstAppliesToHomeServices).toBe(false);
    }
  });

  it("recognises province codes", () => {
    expect(isProvinceCode("ON")).toBe(true);
    expect(isProvinceCode("on")).toBe(false);
    expect(isProvinceCode("XX")).toBe(false);
    expect(isProvinceCode(1)).toBe(false);
  });
});

describe("salesTaxRatesFor", () => {
  const expected: Record<ProvinceCode, string[]> = {
    AB: ["GST 500"],
    BC: ["GST 500"],
    MB: ["GST 500"],
    NB: ["HST 1500"],
    NL: ["HST 1500"],
    NS: ["HST 1400"],
    NT: ["GST 500"],
    NU: ["GST 500"],
    ON: ["HST 1300"],
    PE: ["HST 1500"],
    QC: ["GST 500", "QST 997.5"],
    SK: ["GST 500"],
    YT: ["GST 500"],
  };

  it.each(PROVINCE_CODES)("%s current rates", (code) => {
    const rates = salesTaxRatesFor(code, TODAY);
    expect(rates.components.map((c) => `${c.kind} ${c.rateBps}`)).toEqual(expected[code]);
    expect(rates.taxDate).toBe(TODAY);
  });

  it("includes PST when enabled for the province", () => {
    const describeRates = (code: ProvinceCode) =>
      salesTaxRatesFor(code, TODAY, withPstEnabled).components.map((c) => `${c.name} ${c.rateBps}`);
    expect(describeRates("BC")).toEqual(["GST 500", "PST 700"]);
    expect(describeRates("MB")).toEqual(["GST 500", "RST 700"]);
    expect(describeRates("SK")).toEqual(["GST 500", "PST 600"]);
  });

  it("switches Nova Scotia from 15% to 14% on 2025-04-01", () => {
    expect(salesTaxRatesFor("NS", "2025-03-31").components[0]?.rateBps).toBe(1500);
    expect(salesTaxRatesFor("NS", "2025-04-01").components[0]?.rateBps).toBe(1400);
    expect(salesTaxRatesFor("NS", "2025-04-01").effectiveFrom).toBe("2025-04-01");
    expect(salesTaxRatesFor("NS", "2020-01-01").components[0]?.rateBps).toBe(1500);
  });

  it("uses the province's local date for an instant", () => {
    // Midnight 2025-04-01 in Halifax (ADT, UTC−3) is 03:00 UTC.
    const before = salesTaxRatesFor("NS", new Date("2025-04-01T02:59:59.999Z"));
    const after = salesTaxRatesFor("NS", new Date("2025-04-01T03:00:00.000Z"));
    expect(before.taxDate).toBe("2025-03-31");
    expect(before.components[0]?.rateBps).toBe(1500);
    expect(after.taxDate).toBe("2025-04-01");
    expect(after.components[0]?.rateBps).toBe(1400);
  });

  it("rejects dates before the data, malformed dates and unknown provinces", () => {
    expect(() => salesTaxRatesFor("ON", "2019-12-31")).toThrow(/no sales tax data/);
    expect(() => salesTaxRatesFor("ON", "2026-02-30")).toThrow(RangeError);
    expect(() => salesTaxRatesFor("ON", "21/10/2026")).toThrow(RangeError);
    expect(() => salesTaxRatesFor("ON", new Date(Number.NaN))).toThrow(RangeError);
    expect(() => salesTaxRatesFor("XX" as ProvinceCode, TODAY)).toThrow(/unknown province/);
  });
});

describe("calculateSalesTax", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("taxes price and fee for a registered Ontario business", () => {
    const result = calculateSalesTax({
      province: "ON",
      at: TODAY,
      priceCents: 6000,
      serviceFeeCents: 395,
      businessTaxRegistered: true,
    });
    expect(result.lines).toEqual([
      {
        kind: "HST",
        label: "HST (13%)",
        rateBps: 1300,
        onPriceCents: 780,
        onFeeCents: 51, // 51.35 -> 51
        amountCents: 831,
      },
    ]);
    expect(result.taxOnPriceCents).toBe(780);
    expect(result.taxOnFeeCents).toBe(51);
    expect(result.totalTaxCents).toBe(831);
  });

  it("taxes only the service fee when the business is not registered", () => {
    const result = calculateSalesTax({
      province: "ON",
      at: TODAY,
      priceCents: 10000,
      serviceFeeCents: 639,
      businessTaxRegistered: false,
    });
    expect(result.taxOnPriceCents).toBe(0);
    expect(result.taxOnFeeCents).toBe(83);
    expect(result.lines).toEqual([
      {
        kind: "HST",
        label: "HST (13%)",
        rateBps: 1300,
        onPriceCents: 0,
        onFeeCents: 83,
        amountCents: 83,
      },
    ]);
  });

  it("itemises GST and QST in Quebec, rounding each half-up", () => {
    const result = calculateSalesTax({
      province: "QC",
      at: TODAY,
      priceCents: 10000,
      serviceFeeCents: 639,
      businessTaxRegistered: true,
    });
    expect(result.lines.map((line) => [line.label, line.onPriceCents, line.onFeeCents])).toEqual([
      ["GST (5%)", 500, 32], // 31.95 -> 32
      ["QST (9.975%)", 998, 64], // 997.5 -> 998, 63.74 -> 64
    ]);
    expect(result.totalTaxCents).toBe(500 + 32 + 998 + 64);
  });

  it("charges GST only in BC by default and GST + PST when enabled", () => {
    const base = { province: "BC", at: TODAY, priceCents: 10000, serviceFeeCents: 639 } as const;
    const off = calculateSalesTax({ ...base, businessTaxRegistered: true });
    expect(off.lines.map((line) => line.label)).toEqual(["GST (5%)"]);
    const on = calculateSalesTax({ ...base, businessTaxRegistered: true, table: withPstEnabled });
    expect(on.lines.map((line) => [line.label, line.amountCents])).toEqual([
      ["GST (5%)", 532],
      ["PST (7%)", 745], // 700 + 44.73 -> 45
    ]);
  });

  it("labels Manitoba's PST as RST", () => {
    const result = calculateSalesTax({
      province: "MB",
      at: TODAY,
      priceCents: 1000,
      serviceFeeCents: 100,
      businessTaxRegistered: true,
      table: withPstEnabled,
    });
    expect(result.lines.map((line) => line.label)).toEqual(["GST (5%)", "RST (7%)"]);
  });

  it("omits zero-amount lines", () => {
    const result = calculateSalesTax({
      province: "ON",
      at: TODAY,
      priceCents: 10000,
      serviceFeeCents: 0,
      businessTaxRegistered: false,
    });
    expect(result.lines).toEqual([]);
    expect(result.totalTaxCents).toBe(0);
  });

  it("uses Nova Scotia's old rate for a charge before 2025-04-01", () => {
    const input = { province: "NS", priceCents: 10000, serviceFeeCents: 639 } as const;
    const old = calculateSalesTax({ ...input, at: "2025-03-31", businessTaxRegistered: true });
    const current = calculateSalesTax({ ...input, at: "2025-04-01", businessTaxRegistered: true });
    expect(old.lines[0]?.label).toBe("HST (15%)");
    expect(old.totalTaxCents).toBe(1500 + 96); // 95.85 -> 96
    expect(current.lines[0]?.label).toBe("HST (14%)");
    expect(current.totalTaxCents).toBe(1400 + 89); // 89.46 -> 89
  });

  it("defaults the tax date to now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-03-15T12:00:00Z"));
    const result = calculateSalesTax({
      province: "NS",
      priceCents: 10000,
      serviceFeeCents: 0,
      businessTaxRegistered: true,
    });
    expect(result.taxDate).toBe("2025-03-15");
    expect(result.totalTaxCents).toBe(1500);
  });

  it("rejects invalid amounts", () => {
    const base = { province: "ON", at: TODAY, businessTaxRegistered: true } as const;
    expect(() => calculateSalesTax({ ...base, priceCents: -1, serviceFeeCents: 0 })).toThrow(
      /priceCents/,
    );
    expect(() => calculateSalesTax({ ...base, priceCents: 100, serviceFeeCents: 1.5 })).toThrow(
      /serviceFeeCents/,
    );
  });
});
