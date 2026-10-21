import { sql } from "drizzle-orm";
import { check, doublePrecision, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { id, latitudeCheck, longitudeCheck, timestamps, tstz } from "./columns.ts";
import { partyRole, province } from "./enums.ts";

/**
 * Canadian postal code in canonical form `A1A 1A1` (uppercase, single space).
 * D, F, I, O, Q, U never appear; W and Z never lead.
 */
export const POSTAL_CODE_PATTERN =
  "^[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z] [0-9][ABCEGHJ-NPRSTV-Z][0-9]$";

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
    check(
      "addresses_postal_code_format",
      sql`${t.postalCode} ~ ${sql.raw(`'${POSTAL_CODE_PATTERN}'`)}`,
    ),
    check("addresses_lat_lng_together", sql`(${t.lat} IS NULL) = (${t.lng} IS NULL)`),
    latitudeCheck("addresses", t.lat),
    longitudeCheck("addresses", t.lng),
  ],
);

/** Per-user app profile (1:1 with `user`). Ratings are derived per role from `reviews`. */
export const profiles = pgTable("profiles", {
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
  ...timestamps(),
});
