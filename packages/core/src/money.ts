/**
 * Money helpers. Every stored or computed amount is an integer number of CAD cents.
 * Rounding happens only at defined points and is always half-up to the cent.
 */

/** A non-negative integer number of CAD cents. */
export type Cents = number;

/** Parts per million: the exact integer scale used internally for rates. */
const PPM_PER_BASIS_POINT = 100;
const PPM_SCALE = 1_000_000n;

/** Throws unless `value` is a non-negative safe integer (a valid amount of cents). */
export function assertCents(value: number, name = "amount"): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be an integer number of cents, got ${String(value)}`);
  }
  if (value < 0) {
    throw new RangeError(`${name} must not be negative, got ${value}`);
  }
}

export function isCents(value: unknown): value is Cents {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Validates and returns an amount of cents. */
export function cents(value: number): Cents {
  assertCents(value);
  return value;
}

/**
 * Converts a dollar amount to cents, rounding half-up.
 *
 * Uses the number's shortest decimal representation (what you would type), so
 * `1.005` becomes 101 cents even though its binary value is slightly below 1.005.
 */
export function roundHalfUpToCents(dollars: number): Cents {
  if (!Number.isFinite(dollars)) {
    throw new RangeError(`dollars must be a finite number, got ${String(dollars)}`);
  }
  if (dollars < 0) {
    throw new RangeError(`dollars must not be negative, got ${dollars}`);
  }
  if (dollars * 100 > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`dollars is too large to represent in cents: ${dollars}`);
  }
  const text = String(dollars);
  // Exponent notation only appears here for values below 1e-6, which round to zero.
  if (text.includes("e")) return 0;
  const [whole = "0", fraction = ""] = text.split(".");
  const padded = fraction.padEnd(3, "0");
  const roundUp = Number(padded[2]) >= 5 ? 1 : 0;
  const result = Number(whole) * 100 + Number(padded.slice(0, 2)) + roundUp;
  assertCents(result);
  return result;
}

/** Formats cents as Canadian dollars, e.g. 123456 -> "$1,234.56" and -500 -> "-$5.00". */
export function formatCad(amount: number): string {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`amount must be an integer number of cents, got ${String(amount)}`);
  }
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const remainder = (abs % 100).toString().padStart(2, "0");
  return `${sign}$${dollars}.${remainder}`;
}

/**
 * A price typed by a person ("60", "$1,250.5", "45.00") as cents, without floating point;
 * null when it isn't a plain dollar amount with at most two decimals.
 */
export function parseDollarsToCents(input: string): Cents | null {
  const compact = input.trim().replace(/^\$/, "").replace(/,/g, "");
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(compact);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  return cents(whole * 100 + fraction);
}

/** Cents as an editable dollar amount: 6000 → "60", 6050 → "60.50". */
export function centsToDollarInput(amount: number): string {
  assertCents(amount);
  const whole = Math.floor(amount / 100);
  const fraction = amount % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0")}`;
}

/** Sums amounts of cents, validating each one and the result. */
export function sumCents(amounts: readonly number[]): Cents {
  let total = 0;
  for (const [index, amount] of amounts.entries()) {
    assertCents(amount, `amounts[${index}]`);
    total += amount;
  }
  assertCents(total, "sum");
  return total;
}

/** Alias of {@link sumCents}. */
export const sum = sumCents;

/** `a - b`, throwing if the result would be negative. */
export function subtractCents(a: number, b: number): Cents {
  assertCents(a, "a");
  assertCents(b, "b");
  if (b > a) {
    throw new RangeError(`cannot subtract ${b} from ${a}: result would be negative`);
  }
  return a - b;
}

/**
 * Converts basis points (1 bp = 0.01%) to an exact integer number of parts per million.
 * Fractional basis points are allowed down to 0.01 bp (e.g. Quebec's QST is 997.5 bp).
 */
export function basisPointsToPpm(basisPoints: number): bigint {
  if (!Number.isFinite(basisPoints) || basisPoints < 0) {
    throw new RangeError(
      `basis points must be a non-negative finite number, got ${String(basisPoints)}`,
    );
  }
  const scaled = basisPoints * PPM_PER_BASIS_POINT;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-6 || !Number.isSafeInteger(rounded)) {
    throw new RangeError(`basis points support at most two decimals, got ${basisPoints}`);
  }
  return BigInt(rounded);
}

/** Exact `numerator / denominator` for non-negative integers, rounded half-up. */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("denominator must be positive");
  if (numerator < 0n) throw new RangeError("numerator must not be negative");
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** Converts an exact bigint amount back to cents, checking it is representable. */
export function bigintToCents(value: bigint): Cents {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`amount out of range: ${value}`);
  }
  return Number(value);
}

/** `amount × basisPoints / 10 000`, rounded half-up to the cent. */
export function percentOf(amount: number, basisPoints: number): Cents {
  assertCents(amount);
  const ppm = basisPointsToPpm(basisPoints);
  return bigintToCents(divideRoundHalfUp(BigInt(amount) * ppm, PPM_SCALE));
}

/** Formats basis points as a percentage label without float noise, e.g. 997.5 -> "9.975%". */
export function formatBasisPoints(basisPoints: number): string {
  const ppm = basisPointsToPpm(basisPoints);
  const whole = ppm / 10_000n;
  const fraction = (ppm % 10_000n).toString().padStart(4, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}%` : `${whole}%`;
}
