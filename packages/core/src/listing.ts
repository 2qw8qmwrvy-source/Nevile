/**
 * Business listings (SPEC §18): what a business may edit, and when it can be published.
 */
import { z } from "zod";
import { CANCELLATION_POLICY_IDS } from "./cancellation.ts";
import { CATEGORY_SLUGS } from "./categories.ts";
import { launchPointSchema } from "./geo.ts";
import { BUSINESS_NAME_MAX_LENGTH, BUSINESS_NAME_MIN_LENGTH } from "./schemas.ts";

export const LISTING_ABOUT_MIN_LENGTH = 40;
export const LISTING_ABOUT_MAX_LENGTH = 2000;
export const MAX_BUSINESS_PHOTOS = 8;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_ALT_MAX_LENGTH = 160;
export const SERVICE_TITLE_MIN_LENGTH = 3;
export const SERVICE_TITLE_MAX_LENGTH = 80;
export const SERVICE_DESCRIPTION_MAX_LENGTH = 1000;
/** $1 to $100,000 per visit. */
export const SERVICE_PRICE_MIN_CENTS = 100;
export const SERVICE_PRICE_MAX_CENTS = 10_000_000;
export const SERVICE_DURATION_MIN_MINUTES = 15;
export const SERVICE_DURATION_MAX_MINUTES = 1440;
export const SERVICE_RADIUS_MIN_KM = 1;
export const SERVICE_RADIUS_MAX_KM = 100;

/** CRA GST/HST program account: 9 digits, "RT", 4 digits. Spaces and dashes are ignored. */
export const GST_HST_NUMBER_REGEX = /^[0-9]{9}RT[0-9]{4}$/;

export function normalizeGstHstNumber(value: string): string | null {
  const compact = value.toUpperCase().replace(/[\s-]/g, "");
  return GST_HST_NUMBER_REGEX.test(compact) ? compact : null;
}

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, { message: `${label} needs at least ${min} characters` })
    .max(max, { message: `${label} can be up to ${max} characters` })
    .regex(/^[^\p{Cc}]*$/u, { message: `${label} can't contain control characters` });

/** True when the text has control characters other than line breaks and tabs. */
export function hasDisallowedControlCharacters(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    if (isControl && character !== "\n" && character !== "\r" && character !== "\t") return true;
  }
  return false;
}

/** Text that may span lines (newlines and tabs allowed, other control characters not). */
const multiline = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, { message: `${label} needs at least ${min} characters` })
    .max(max, { message: `${label} can be up to ${max} characters` })
    .refine((text) => !hasDisallowedControlCharacters(text), {
      message: `${label} can't contain control characters`,
    });

export const businessProfileSchema = z.object({
  name: trimmed(BUSINESS_NAME_MIN_LENGTH, BUSINESS_NAME_MAX_LENGTH, "The business name"),
  // Saved as a draft at any length; publishing needs LISTING_ABOUT_MIN_LENGTH.
  description: multiline(0, LISTING_ABOUT_MAX_LENGTH, "About"),
  /** Empty means not registered (no HST on the job price, SPEC §7). */
  gstHstNumber: z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (!value) return null;
      const normalized = normalizeGstHstNumber(value);
      if (!normalized) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a GST/HST number like 123456789 RT 0001, or leave it empty",
        });
        return z.NEVER;
      }
      return normalized;
    }),
  cancellationPolicy: z.enum(CANCELLATION_POLICY_IDS),
  instantBook: z.boolean(),
});
export type BusinessProfileInput = z.input<typeof businessProfileSchema>;

export const serviceAreaInputSchema = z.object({
  center: launchPointSchema,
  radiusKm: z.number().int().min(SERVICE_RADIUS_MIN_KM).max(SERVICE_RADIUS_MAX_KM),
});
export type ServiceAreaInput = z.input<typeof serviceAreaInputSchema>;

const cents = (min: number, max: number) =>
  z
    .number()
    .int({ message: "Use whole cents" })
    .min(min, { message: `At least $${min / 100}` })
    .max(max, { message: `At most $${(max / 100).toLocaleString("en-CA")}` });

export const serviceInputSchema = z
  .object({
    categorySlug: z.enum(CATEGORY_SLUGS),
    title: trimmed(SERVICE_TITLE_MIN_LENGTH, SERVICE_TITLE_MAX_LENGTH, "The title"),
    description: multiline(0, SERVICE_DESCRIPTION_MAX_LENGTH, "The description"),
    pricingType: z.enum(["fixed", "quote"]),
    priceCents: cents(SERVICE_PRICE_MIN_CENTS, SERVICE_PRICE_MAX_CENTS).nullable(),
    fromPriceCents: cents(SERVICE_PRICE_MIN_CENTS, SERVICE_PRICE_MAX_CENTS).nullable(),
    durationMinutes: z
      .number()
      .int()
      .min(SERVICE_DURATION_MIN_MINUTES, { message: "At least 15 minutes" })
      .max(SERVICE_DURATION_MAX_MINUTES, { message: "At most 24 hours" }),
    instantBook: z.boolean(),
    active: z.boolean(),
  })
  .superRefine((service, ctx) => {
    if (service.pricingType === "fixed") {
      if (service.priceCents === null) {
        ctx.addIssue({
          code: "custom",
          path: ["priceCents"],
          message: "Enter the price per visit",
        });
      }
      if (service.fromPriceCents !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["fromPriceCents"],
          message: "“From” prices are only for quote services",
        });
      }
    } else {
      if (service.priceCents !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["priceCents"],
          message: "Quote services don't have a fixed price",
        });
      }
      if (service.instantBook) {
        ctx.addIssue({
          code: "custom",
          path: ["instantBook"],
          message: "Instant Book is only for fixed-price services",
        });
      }
    }
  });
export type ServiceInput = z.input<typeof serviceInputSchema>;

export const photoAltSchema = z
  .string()
  .trim()
  .max(PHOTO_ALT_MAX_LENGTH)
  .regex(/^[^\p{Cc}]*$/u);

export type ListingFacts = {
  verified: boolean;
  suspended: boolean;
  name: string;
  description: string | null;
  hasServiceArea: boolean;
  activeServices: number;
};

export const LISTING_REQUIREMENTS = {
  verify_contact: "Confirm your email or phone number",
  name: "Add your business name",
  about: `Write at least ${LISTING_ABOUT_MIN_LENGTH} characters about your business`,
  service_area: "Set your service area on the map",
  services: "Add at least one active service",
  not_suspended: "This business is suspended. Contact Nevile support.",
} as const;
export type ListingRequirement = keyof typeof LISTING_REQUIREMENTS;

/** What still stands between a business and being published (SPEC §18), in order. */
export function listingReadiness(facts: ListingFacts): {
  ready: boolean;
  missing: ListingRequirement[];
} {
  const missing: ListingRequirement[] = [];
  if (facts.suspended) missing.push("not_suspended");
  if (!facts.verified) missing.push("verify_contact");
  if (facts.name.trim().length < BUSINESS_NAME_MIN_LENGTH) missing.push("name");
  if ((facts.description ?? "").trim().length < LISTING_ABOUT_MIN_LENGTH) missing.push("about");
  if (!facts.hasServiceArea) missing.push("service_area");
  if (facts.activeServices < 1) missing.push("services");
  return { ready: missing.length === 0, missing };
}

/** "45 min", "1 hr", "1 hr 30 min", "8 hr" — a service's typical duration. */
export function formatDurationMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** Durations offered in the service form, in minutes. */
export const SERVICE_DURATION_CHOICES = [
  15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, 600, 720, 1440,
] as const;
