/**
 * Optional welcome flow — SPEC §16 — and CASL marketing consent — SPEC §17.
 *
 * Welcome steps: (1) "I need help at home" / "I run a business" / both, (2) a Nova Scotia
 * postal code, (3) the services that matter to them, used to personalise the homepage.
 */
import { z } from "zod";
import { CATEGORY_SLUGS } from "./categories.ts";
import { launchPostalCodeSchema } from "./region.ts";

export const ONBOARDING_INTENTS = ["customer", "business", "both"] as const;
export type OnboardingIntent = (typeof ONBOARDING_INTENTS)[number];

export const ONBOARDING_MAX_INTERESTS = CATEGORY_SLUGS.length;

export const onboardingSchema = z.object({
  intent: z.enum(ONBOARDING_INTENTS),
  postalCode: launchPostalCodeSchema,
  interests: z
    .array(z.enum(CATEGORY_SLUGS))
    .max(ONBOARDING_MAX_INTERESTS)
    .refine((slugs) => new Set(slugs).size === slugs.length, {
      message: "Choose each service only once",
    })
    .default([]),
});
export type OnboardingInput = z.input<typeof onboardingSchema>;
export type Onboarding = z.output<typeof onboardingSchema>;

/**
 * Version of the marketing consent wording. Recorded with the timestamp whenever someone
 * ticks the (optional, unticked by default) checkbox; bump it whenever the text changes.
 */
export const MARKETING_CONSENT_VERSION = "2026-10-v1";

export const MARKETING_CONSENT_STATEMENT =
  "Send me tips, seasonal reminders and Nevile news by email. You can unsubscribe at any time.";
/** CASL requires identifying who is asking for consent. */
export const MARKETING_CONSENT_SENDER = "Nevile, Nova Scotia";
/** The full consent wording shown beside the checkbox, statement then sender line. */
export const MARKETING_CONSENT_TEXT = `${MARKETING_CONSENT_STATEMENT}\n${MARKETING_CONSENT_SENDER}`;
