/** Shared Zod schemas for validating external input (forms, API procedures). */
import { z } from "zod";
import { CANCELLATION_POLICY_IDS } from "./cancellation.ts";
import { RECURRENCE_FREQUENCIES } from "./recurrence.ts";
import { PROVINCE_CODES } from "./tax.ts";

/** Trimmed and lower-cased so sign-in and uniqueness checks are case-insensitive. */
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Not trimmed: every character the user typed is part of the password. */
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

const PHONE_FORMATTING = /[\s().\-‐-―]/g;
const NANP_SUBSCRIBER = /^([2-9]\d{2})([2-9]\d{2})(\d{4})$/;

/**
 * Normalizes a North American (+1) phone number to E.164 ("+14165551234"), or returns
 * null. Accepts common layouts ("(416) 555-1234", "416.555.1234", "1 416 555 1234",
 * "+1-416-555-1234"). Area codes are validated structurally (NANP rules, no N11 codes)
 * rather than against a list, so newly introduced Canadian overlays keep working.
 */
export function normalizeCanadianPhone(input: string): string | null {
  let value = input.trim().replace(PHONE_FORMATTING, "");
  if (value.startsWith("+")) {
    if (!value.startsWith("+1")) return null;
    value = value.slice(2);
  } else if (value.length === 11 && value.startsWith("1")) {
    value = value.slice(1);
  }
  const match = NANP_SUBSCRIBER.exec(value);
  if (!match) return null;
  const [, area = "", exchange = ""] = match;
  if (area.endsWith("11") || exchange.endsWith("11")) return null;
  return `+1${value}`;
}

export const canadianPhoneSchema = z
  .string()
  .refine((value) => normalizeCanadianPhone(value) !== null, {
    message: "Enter a valid Canadian phone number",
  })
  .transform((value) => normalizeCanadianPhone(value) as string);

/** Canadian postal codes never use D, F, I, O, Q or U, and never start with W or Z. */
const POSTAL_CODE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/;

/** Normalizes a Canadian postal code to "A1A 1A1", or returns null. */
export function normalizePostalCode(input: string): string | null {
  const compact = input.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!POSTAL_CODE.test(compact)) return null;
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

export const postalCodeSchema = z
  .string()
  .refine((value) => normalizePostalCode(value) !== null, {
    message: "Enter a valid Canadian postal code (e.g. A1A 1A1)",
  })
  .transform((value) => normalizePostalCode(value) as string);

/** Accepts lower-case input ("on") and outputs the canonical code ("ON"). */
export const provinceCodeSchema = z.string().trim().toUpperCase().pipe(z.enum(PROVINCE_CODES));

export const PRICING_TYPES = ["fixed", "quote"] as const;
export type PricingType = (typeof PRICING_TYPES)[number];
export const pricingTypeSchema = z.enum(PRICING_TYPES);

export const cancellationPolicySchema = z.enum(CANCELLATION_POLICY_IDS);

export const recurrenceFrequencySchema = z.enum(RECURRENCE_FREQUENCIES);

/** $100,000.00 */
export const MAX_MONEY_INPUT_CENTS = 10_000_000;

/** A non-negative integer amount of cents, at most $100,000. */
export const moneyInputSchema = z
  .number()
  .int({ message: "Amount must be a whole number of cents" })
  .min(0, { message: "Amount must not be negative" })
  .max(MAX_MONEY_INPUT_CENTS, { message: "Amount must be at most $100,000.00" });
