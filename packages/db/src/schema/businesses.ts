import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import {
  createdAt,
  DEFAULT_TIMEZONE,
  id,
  latitudeCheck,
  longitudeCheck,
  slugCheck,
  timestamps,
  tstz,
} from "./columns.ts";
import {
  approvalStatus,
  businessMemberRole,
  businessPlan,
  cancellationPolicy,
  province,
} from "./enums.ts";

/** CRA GST/HST program account: 9-digit business number + `RT` + 4-digit reference. */
export const GST_HST_NUMBER_PATTERN = "^[0-9]{9}RT[0-9]{4}$";

export const SERVICE_RADIUS_KM = { min: 1, max: 100 } as const;

export const businesses = pgTable(
  "businesses",
  {
    id: id(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description"),
    // Contact details are hidden from customers until a booking is paid (SPEC §7).
    phone: text("phone"),
    email: text("email"),
    gstHstNumber: text("gst_hst_number"),
    // Sales tax applies to the business's price only when registered (SPEC §7).
    taxRegistered: boolean("tax_registered").notNull().default(false),
    province: province("province").notNull(),
    timezone: text("timezone").notNull().default(DEFAULT_TIMEZONE),
    cancellationPolicy: cancellationPolicy("cancellation_policy").notNull().default("flexible"),
    // Fixed-price bookings confirm instantly instead of waiting for approval.
    instantBook: boolean("instant_book").notNull().default(false),
    // "Take quote requests" (SPEC §20): on by default; off hides Request a quote.
    acceptsQuoteRequests: boolean("accepts_quote_requests").notNull().default(true),
    stripeAccountId: text("stripe_account_id").unique(),
    // Set from Stripe Connect once identity verification passes (SPEC §1).
    payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
    // Admin approved an insurance document → "Verified" badge.
    verifiedInsuranceAt: tstz("verified_insurance_at"),
    plan: businessPlan("plan").notNull().default("free"),
    suspendedAt: tstz("suspended_at"),
    // Processed square logo in media storage (SPEC §18); null shows initials.
    logoKey: text("logo_key").unique(),
    // Listed in search while set (SPEC §18); publishing checks readiness first.
    publishedAt: tstz("published_at"),
    // How soon / how far ahead customers can book, in days from today (SPEC §19).
    minNoticeDays: smallint("min_notice_days").notNull().default(1),
    maxDaysAhead: smallint("max_days_ahead").notNull().default(60),
    // Set by the first paid booking while payouts aren't set up: 7 days to finish.
    payoutSetupDueAt: tstz("payout_setup_due_at"),
    payoutSetupReminderSentAt: tstz("payout_setup_reminder_sent_at"),
    // When Nevile last cancelled upcoming bookings for missing payout setup.
    payoutSetupEnforcedAt: tstz("payout_setup_enforced_at"),
    ...timestamps(),
  },
  (t) => [
    index("businesses_owner_user_id_idx").on(t.ownerUserId),
    index("businesses_published_idx")
      .on(t.publishedAt)
      .where(sql`${t.publishedAt} IS NOT NULL AND ${t.suspendedAt} IS NULL`),
    slugCheck("businesses", t.slug),
    check(
      "businesses_gst_hst_number_format",
      sql`${t.gstHstNumber} ~ ${sql.raw(`'${GST_HST_NUMBER_PATTERN}'`)}`,
    ),
    check(
      "businesses_tax_registration_number",
      sql`NOT ${t.taxRegistered} OR ${t.gstHstNumber} IS NOT NULL`,
    ),
    check(
      "businesses_payouts_require_stripe",
      sql`NOT ${t.payoutsEnabled} OR ${t.stripeAccountId} IS NOT NULL`,
    ),
    check(
      "businesses_booking_notice",
      sql`${t.minNoticeDays} BETWEEN 0 AND 14 AND ${t.maxDaysAhead} BETWEEN 7 AND 180 AND ${t.minNoticeDays} < ${t.maxDaysAhead}`,
    ),
    index("businesses_payout_setup_due_idx")
      .on(t.payoutSetupDueAt)
      .where(sql`${t.payoutSetupDueAt} IS NOT NULL AND NOT ${t.payoutsEnabled}`),
  ],
);

/** Owner, managers and crew. Team members are free on every plan (SPEC §1). */
export const businessMembers = pgTable(
  "business_members",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: businessMemberRole("role").notNull().default("crew"),
    // Hex colour for the member's lane on the team calendar.
    calendarColor: text("calendar_color"),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    unique("business_members_business_user_unique").on(t.businessId, t.userId),
    // Target of composite FKs that keep bookings/visits on their own business's crew.
    unique("business_members_business_id_unique").on(t.businessId, t.id),
    index("business_members_user_id_idx").on(t.userId),
    uniqueIndex("business_members_one_owner_uidx").on(t.businessId).where(sql`${t.role} = 'owner'`),
    check("business_members_calendar_color_hex", sql`${t.calendarColor} ~ '^#[0-9A-Fa-f]{6}$'`),
  ],
);

/** Pending invitations for crew/managers who may not have an account yet. */
export const businessInvites = pgTable(
  "business_invites",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    email: text("email"),
    phoneNumber: text("phone_number"),
    role: businessMemberRole("role").notNull().default("crew"),
    // Store only a hash of the invite token; the raw token goes in the link.
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: tstz("expires_at").notNull(),
    acceptedAt: tstz("accepted_at"),
    acceptedByUserId: text("accepted_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    revokedAt: tstz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("business_invites_business_id_idx").on(t.businessId),
    check("business_invites_contact", sql`num_nonnulls(${t.email}, ${t.phoneNumber}) >= 1`),
    check("business_invites_not_owner", sql`${t.role} <> 'owner'`),
  ],
);

/** Proof of insurance; an admin approval sets `businesses.verified_insurance_at`. */
export const insuranceDocuments = pgTable(
  "insurance_documents",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    uploadedByUserId: text("uploaded_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    storageKey: text("storage_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    expiresOn: date("expires_on", { mode: "string" }),
    status: approvalStatus("status").notNull().default("pending"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: tstz("reviewed_at"),
    rejectionReason: text("rejection_reason"),
    ...timestamps(),
  },
  (t) => [
    index("insurance_documents_business_id_idx").on(t.businessId),
    index("insurance_documents_status_created_idx").on(t.status, t.createdAt),
    check(
      "insurance_documents_reviewed",
      sql`${t.status} = 'pending' OR ${t.reviewedAt} IS NOT NULL`,
    ),
  ],
);

/**
 * Map pin + radius slider (SPEC §2). Customers only see businesses whose radius covers
 * their address; the (lat, lng) index supports a bounding-box prefilter before the
 * exact great-circle distance check.
 */
export const serviceAreas = pgTable(
  "service_areas",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    // Nearest postal-area place name, e.g. "Bedford", for "Serves about 25 km around …".
    label: text("label"),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    radiusKm: integer("radius_km").notNull(),
    ...timestamps(),
  },
  (t) => [
    // One area per business for now (SPEC §18); the API upserts it.
    uniqueIndex("service_areas_business_id_uidx").on(t.businessId),
    index("service_areas_lat_lng_idx").on(t.lat, t.lng),
    latitudeCheck("service_areas", t.lat),
    longitudeCheck("service_areas", t.lng),
    check(
      "service_areas_radius_km_range",
      sql`${t.radiusKm} BETWEEN ${sql.raw(String(SERVICE_RADIUS_KM.min))} AND ${sql.raw(String(SERVICE_RADIUS_KM.max))}`,
    ),
  ],
);
