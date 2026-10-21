import { describe, expect, it } from "vitest";
import {
  assertCents,
  basisPointsToPpm,
  bigintToCents,
  cents,
  divideRoundHalfUp,
  formatBasisPoints,
  formatCad,
  isCents,
  percentOf,
  roundHalfUpToCents,
  subtractCents,
  sum,
  sumCents,
} from "./money.ts";

describe("cents / isCents / assertCents", () => {
  it("accepts non-negative safe integers", () => {
    expect(cents(0)).toBe(0);
    expect(cents(123)).toBe(123);
    expect(cents(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(isCents(42)).toBe(true);
  });

  it.each([1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, -0.01])(
    "rejects %s",
    (value) => {
      expect(() => cents(value)).toThrow(RangeError);
      expect(isCents(value)).toBe(false);
    },
  );

  it("rejects non-numbers in isCents", () => {
    expect(isCents("100")).toBe(false);
    expect(isCents(null)).toBe(false);
  });

  it("names the offending field", () => {
    expect(() => assertCents(-5, "priceCents")).toThrow(/priceCents/);
  });
});

describe("roundHalfUpToCents", () => {
  it.each([
    [0, 0],
    [1, 100],
    [0.01, 1],
    [0.005, 1],
    [0.0049, 0],
    [1.005, 101], // binary value is 1.00499999…; we round the decimal as written
    [1.004, 100],
    [1.015, 102],
    [2.675, 268],
    [0.125, 13],
    [0.1 + 0.2, 30],
    [19.999, 2000],
    [123456.789, 12345679],
    [1e-7, 0],
    [106.385, 10639],
  ])("%s dollars -> %s cents", (dollars, expected) => {
    expect(roundHalfUpToCents(dollars)).toBe(expected);
  });

  it.each([-0.01, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e14])("rejects %s", (dollars) => {
    expect(() => roundHalfUpToCents(dollars)).toThrow(RangeError);
  });
});

describe("formatCad", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [99, "$0.99"],
    [100, "$1.00"],
    [123456, "$1,234.56"],
    [100000, "$1,000.00"],
    [99999999, "$999,999.99"],
    [100000000, "$1,000,000.00"],
    [-500, "-$5.00"],
    [-123456, "-$1,234.56"],
  ])("%s -> %s", (amount, expected) => {
    expect(formatCad(amount)).toBe(expected);
  });

  it("rejects non-integers", () => {
    expect(() => formatCad(1.5)).toThrow(RangeError);
    expect(() => formatCad(Number.NaN)).toThrow(RangeError);
  });
});

describe("sumCents / subtractCents", () => {
  it("sums amounts", () => {
    expect(sumCents([])).toBe(0);
    expect(sumCents([1, 2, 3])).toBe(6);
    expect(sum([10000, 639, 1383])).toBe(12022);
  });

  it("validates every amount", () => {
    expect(() => sumCents([1, -1])).toThrow(/amounts\[1\]/);
    expect(() => sumCents([1.5])).toThrow(RangeError);
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
  });

  it("subtracts without going negative", () => {
    expect(subtractCents(5, 3)).toBe(2);
    expect(subtractCents(5, 5)).toBe(0);
    expect(() => subtractCents(3, 5)).toThrow(RangeError);
    expect(() => subtractCents(3, 0.5)).toThrow(RangeError);
  });
});

describe("percentOf", () => {
  it.each([
    [10000, 300, 300],
    [1, 5000, 1], // 0.5 -> 1 (half-up)
    [3, 5000, 2], // 1.5 -> 2
    [5, 1000, 1], // 0.5 -> 1
    [4, 1000, 0], // 0.4 -> 0
    [395, 1300, 51], // 51.35
    [1125, 1300, 146], // 146.25
    [639, 1300, 83], // 83.07
    [6000, 1300, 780],
    [100, 997.5, 10], // 9.975
    [10000, 997.5, 998], // 997.5
    [1050, 300, 32], // 31.5
    [1016, 300, 30], // 30.48
    [0, 1300, 0],
    [12345, 0, 0],
    [12345, 10000, 12345],
  ])("%s × %s bp = %s", (amount, bps, expected) => {
    expect(percentOf(amount, bps)).toBe(expected);
  });

  it("is exact for large amounts", () => {
    expect(percentOf(9_000_000_000_000, 997.5)).toBe(897_750_000_000);
  });

  it.each([
    [-1, 100],
    [1.5, 100],
    [100, -1],
    [100, Number.NaN],
    [100, 0.001],
  ])("rejects amount %s with %s bp", (amount, bps) => {
    expect(() => percentOf(amount, bps)).toThrow(RangeError);
  });
});

describe("basis-point helpers", () => {
  it("converts basis points to exact ppm", () => {
    expect(basisPointsToPpm(290)).toBe(29_000n);
    expect(basisPointsToPpm(997.5)).toBe(99_750n);
    expect(basisPointsToPpm(0.01)).toBe(1n);
    expect(() => basisPointsToPpm(0.005)).toThrow(RangeError);
  });

  it.each([
    [1300, "13%"],
    [500, "5%"],
    [997.5, "9.975%"],
    [290, "2.9%"],
    [1, "0.01%"],
    [0.5, "0.005%"],
    [10000, "100%"],
  ])("formats %s bp as %s", (bps, label) => {
    expect(formatBasisPoints(bps)).toBe(label);
  });

  it("divides with half-up rounding", () => {
    expect(divideRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divideRoundHalfUp(4n, 3n)).toBe(1n);
    expect(divideRoundHalfUp(5n, 3n)).toBe(2n);
    expect(divideRoundHalfUp(0n, 7n)).toBe(0n);
    expect(() => divideRoundHalfUp(1n, 0n)).toThrow(RangeError);
    expect(() => divideRoundHalfUp(-1n, 2n)).toThrow(RangeError);
  });

  it("converts bigints back to safe cents", () => {
    expect(bigintToCents(42n)).toBe(42);
    expect(() => bigintToCents(-1n)).toThrow(RangeError);
    expect(() => bigintToCents(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(RangeError);
  });
});
