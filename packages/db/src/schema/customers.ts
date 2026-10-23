import { sql } from "drizzle-orm";
import { check, doublePrecision, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import {
  id,
  latitudeCheck,
  longitudeCheck,
  postalCodeCheck,
  slugArrayCheck,
  timestamps,
  tstz,
} from "./columns.ts";
import { onboardingIntent, partyRole, province } from "./enums.ts";

export { POSTAL_CODE_PATTERN } from "./columns.ts";

export const addresses = pgTable(
  "addresses",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    label: text("label"),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city").notNull(),
    province: province("province").notNull(),
    postalCode: text("postal_code").notNull(),
    country: text("country").notNull().default("CA"),
    // Geocoded pin; required before the address can be matched against service areas.
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    // Gate codes, parking, pets — visible to the assigned business only.
    accessNotes: text("access_notes"),
    // Addresses referenced by bookings are archived, never deleted.
    archivedAt: tstz("archived_at"),
    ...timestamps(),
  },
  (t) => [
    index("addresses_user_id_idx").on(t.userId),
    check("addresses_country_ca", sql`${t.country} = 'CA'`),
    postalCodeCheck("addresses", t.postalCode),
    check("addresses_lat_lng_together", sql`(${t.lat} IS NULL) = (${t.lng} IS NULL)`),
    latitudeCheck("addresses", t.lat),
    longitudeCheck("addresses", t.lng),
  ],
);

/** Most services a profile can mark as interests (onboarding step 3, SPEC §16). */
export const MAX_PROFILE_INTERESTS = 32;

/**
 * Per-user app profile (1:1 with `user`). Ratings are derived per role from `reviews`.
 * Onboarding and consent columns are nullable because accounts created before v1.1
 * (and users who skip the optional welcome) never filled them.
 */
export const profiles = pgTable(
  "profiles",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    defaultAddressId: uuid("default_address_id").references(() => addresses.id, {
      onDelete: "set null",
    }),
    // "Switch to business mode" toggle (SPEC §1).
    activeMode: partyRole("active_mode").notNull().default("customer"),
    // Stripe Customer used for saved cards (recurring jobs, snow contracts).
    stripeCustomerId: text("stripe_customer_id").unique(),
    // Sign-up postal code, canonical `A1A 1A1` (SPEC §2).
    postalCode: text("postal_code"),
    onboardingIntent: onboardingIntent("onboarding_intent"),
    // Service category slugs the user cares about, for the personalised homepage.
    interests: text("interests").array().notNull().default([]),
    // Welcome finished or skipped; null shows it again.
    onboardedAt: tstz("onboarded_at"),
    // CASL marketing consent (SPEC §17): when the unticked box was ticked, and which
    // version of the consent text was shown. Withdrawal clears both.
    marketingConsentAt: tstz("marketing_consent_at"),
    marketingConsentVersion: text("marketing_consent_version"),
    ...timestamps(),
  },
  (t) => [
    postalCodeCheck("profiles", t.postalCode),
    slugArrayCheck("profiles", t.interests, MAX_PROFILE_INTERESTS),
    check(
      "profiles_marketing_consent_pair",
      sql`(${t.marketingConsentAt} IS NULL) = (${t.marketingConsentVersion} IS NULL)`,
    ),
    check(
      "profiles_marketing_consent_version_not_blank",
      sql`btrim(${t.marketingConsentVersion}) <> ''`,
    ),
  ],
);
