/** Shared Zod schemas for validating external input (forms, API procedures). */
import { z } from "zod";
import { CANCELLATION_POLICY_IDS } from "./cancellation.ts";
import {
  normalizeCanadianPhone,
  normalizePostalCode,
  POSTAL_CODE_INVALID_MESSAGE,
} from "./contact-formats.ts";
import { RECURRENCE_FREQUENCIES } from "./recurrence.ts";
import { PROVINCE_CODES } from "./tax.ts";

/** Trimmed and lower-cased so sign-in and uniqueness checks are case-insensitive. */
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Not trimmed: every character the user typed is part of the password. */
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/** Length limits for a business's display name (API validation and form hints). */
export const BUSINESS_NAME_MIN_LENGTH = 2;
export const BUSINESS_NAME_MAX_LENGTH = 80;

export const canadianPhoneSchema = z
  .string()
  .refine((value) => normalizeCanadianPhone(value) !== null, {
    message: "Enter a valid Canadian phone number",
  })
  .transform((value) => normalizeCanadianPhone(value) as string);

export const postalCodeSchema = z
  .string()
  .refine((value) => normalizePostalCode(value) !== null, {
    message: POSTAL_CODE_INVALID_MESSAGE,
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
