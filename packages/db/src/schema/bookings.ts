import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { businesses, businessMembers } from "./businesses.ts";
import { services } from "./catalog.ts";
import {
  cents,
  createdAt,
  DEFAULT_TIMEZONE,
  id,
  nonNegative,
  positive,
  timestamps,
  tstz,
} from "./columns.ts";
import { addresses } from "./customers.ts";
import {
  bookingKind,
  bookingStatus,
  cancellationPolicy,
  province,
  recurrenceFrequency,
  visitPhotoKind,
  visitStatus,
} from "./enums.ts";
import { quotes } from "./quotes.ts";

/**
 * A customer's booking with a business. Amounts are per charge: per visit for
 * recurring jobs and per-visit snow contracts, the whole job for one-offs and
 * season-priced contracts. Pricing and cancellation terms are snapshots taken at
 * booking time so later business edits never change an agreed price.
 */
export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    customerId: text("customer_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    addressId: uuid("address_id")
      .notNull()
      .references(() => addresses.id, { onDelete: "restrict" }),
    // Set when the booking came from an accepted quote.
    quoteId: uuid("quote_id")
      .unique()
      .references(() => quotes.id, { onDelete: "restrict" }),
    // Default crew member for generated visits (owner/manager assigns, SPEC §1).
    assignedMemberId: uuid("assigned_member_id").references(() => businessMembers.id, {
      onDelete: "set null",
    }),
    kind: bookingKind("kind").notNull(),
    status: bookingStatus("status").notNull(),
    priceCents: cents("price_cents").notNull(),
    serviceFeeCents: cents("service_fee_cents").notNull(),
    // Sales tax on the business's price (zero unless the business is registered).
    priceTaxCents: cents("price_tax_cents").notNull().default(0),
    // Sales tax on Nevile's service fee (always applied).
    feeTaxCents: cents("fee_tax_cents").notNull().default(0),
    totalCents: cents("total_cents").notNull(),
    taxProvince: province("tax_province").notNull(),
    cancellationPolicy: cancellationPolicy("cancellation_policy").notNull(),
    timezone: text("timezone").notNull().default(DEFAULT_TIMEZONE),
    // Requested slot for one-off / on-demand jobs; visits hold the confirmed times.
    requestedStartsAt: tstz("requested_starts_at"),
    requestedEndsAt: tstz("requested_ends_at"),
    customerNotes: text("customer_notes"),
    // Saved card for recurring jobs and snow contracts (SPEC §7).
    stripePaymentMethodId: text("stripe_payment_method_id"),
    // Approval-required requests lapse after 24h with no charge (SPEC §4).
    approvalExpiresAt: tstz("approval_expires_at"),
    confirmedAt: tstz("confirmed_at"),
    cancelledAt: tstz("cancelled_at"),
    cancellationReason: text("cancellation_reason"),
    ...timestamps(),
  },
  (t) => [
    index("bookings_customer_created_idx").on(t.customerId, t.createdAt),
    index("bookings_business_status_created_idx").on(t.businessId, t.status, t.createdAt),
    index("bookings_service_id_idx").on(t.serviceId),
    index("bookings_address_id_idx").on(t.addressId),
    index("bookings_assigned_member_id_idx").on(t.assignedMemberId),
    index("bookings_requested_expires_idx")
      .on(t.approvalExpiresAt)
      .where(sql`${t.status} = 'requested'`),
    // Reliability stats: business-initiated cancellations (SPEC §5).
    index("bookings_business_cancellations_idx")
      .on(t.businessId, t.cancelledAt)
      .where(sql`${t.status} = 'cancelled_by_business'`),
    nonNegative("bookings", t.priceCents),
    nonNegative("bookings", t.serviceFeeCents),
    nonNegative("bookings", t.priceTaxCents),
    nonNegative("bookings", t.feeTaxCents),
    check(
      "bookings_total_is_sum",
      sql`${t.totalCents} = ${t.priceCents} + ${t.serviceFeeCents} + ${t.priceTaxCents} + ${t.feeTaxCents}`,
    ),
    check(
      "bookings_requested_range",
      sql`${t.requestedEndsAt} IS NULL OR ${t.requestedStartsAt} IS NULL OR ${t.requestedEndsAt} > ${t.requestedStartsAt}`,
    ),
    check("bookings_no_quote_phase_status", sql`${t.status} NOT IN ('quote_requested', 'quoted')`),
    check(
      "bookings_requested_expiry",
      sql`${t.status} <> 'requested' OR ${t.approvalExpiresAt} IS NOT NULL`,
    ),
    check(
      "bookings_cancelled_fields",
      sql`${t.status} NOT IN ('cancelled_by_customer', 'cancelled_by_business') OR ${t.cancelledAt} IS NOT NULL`,
    ),
  ],
);

/** Weekly / every-2-weeks / monthly schedule with an end date (SPEC §4). */
export const recurringSeries = pgTable(
  "recurring_series",
  {
    id: id(),
    bookingId: uuid("booking_id")
      .notNull()
      .unique()
      .references(() => bookings.id, { onDelete: "cascade" }),
    frequency: recurrenceFrequency("frequency").notNull(),
    // First occurrence; its local wall-clock time (booking timezone) repeats.
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    // Visits have been generated up to this instant.
    generatedThrough: tstz("generated_through"),
    ...timestamps(),
  },
  (t) => [
    check("recurring_series_range", sql`${t.endsAt} > ${t.startsAt}`),
    check("recurring_series_duration_positive", sql`${t.durationMinutes} > 0`),
  ],
);

/**
 * Seasonal snow & ice contract, e.g. "clear whenever snowfall > 5 cm, Nov–Mar".
 * Priced either per visit or as one season price.
 */
export const snowContracts = pgTable(
  "snow_contracts",
  {
    id: id(),
    bookingId: uuid("booking_id")
      .notNull()
      .unique()
      .references(() => bookings.id, { onDelete: "cascade" }),
    triggerCm: integer("trigger_cm").notNull(),
    seasonStart: date("season_start", { mode: "string" }).notNull(),
    seasonEnd: date("season_end", { mode: "string" }).notNull(),
    perVisitCents: cents("per_visit_cents"),
    seasonPriceCents: cents("season_price_cents"),
    ...timestamps(),
  },
  (t) => [
    positive("snow_contracts", t.triggerCm),
    nonNegative("snow_contracts", t.perVisitCents),
    nonNegative("snow_contracts", t.seasonPriceCents),
    check("snow_contracts_season_range", sql`${t.seasonEnd} > ${t.seasonStart}`),
    check(
      "snow_contracts_one_price",
      sql`num_nonnulls(${t.perVisitCents}, ${t.seasonPriceCents}) = 1`,
    ),
  ],
);

/**
 * One unit of work on a crew calendar. A slot is only locked once a visit exists,
 * i.e. after the booking is confirmed (SPEC §4). Overlap protection per assigned
 * member is an exclusion constraint added in a custom migration
 * (`visits_no_member_overlap`, needs btree_gist).
 */
export const visits = pgTable(
  "visits",
  {
    id: id(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    assignedMemberId: uuid("assigned_member_id").references(() => businessMembers.id, {
      onDelete: "set null",
    }),
    // 1 for one-offs; occurrence number for recurring series and contract visits.
    sequence: integer("sequence").notNull().default(1),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    status: visitStatus("status").notNull().default("confirmed"),
    completedAt: tstz("completed_at"),
    completedByUserId: text("completed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // Customer confirmation time (or the auto-confirm / admin decision time).
    confirmedAt: tstz("confirmed_at"),
    // True when the 48h window lapsed without a customer response.
    autoConfirmed: boolean("auto_confirmed").notNull().default(false),
    autoConfirmAt: tstz("auto_confirm_at"),
    // When this visit should be charged (recurring: 3 days before; snow: after confirm).
    chargeDueAt: tstz("charge_due_at"),
    cancelledAt: tstz("cancelled_at"),
    // Business-only notes (customers never see them).
    businessNotes: text("business_notes"),
    ...timestamps(),
  },
  (t) => [
    unique("visits_booking_sequence_unique").on(t.bookingId, t.sequence),
    index("visits_booking_starts_idx").on(t.bookingId, t.startsAt),
    index("visits_member_starts_idx").on(t.assignedMemberId, t.startsAt),
    index("visits_auto_confirm_idx")
      .on(t.autoConfirmAt)
      .where(sql`${t.status} = 'completed_pending_confirmation'`),
    index("visits_charge_due_idx").on(t.chargeDueAt).where(sql`${t.chargeDueAt} IS NOT NULL`),
    positive("visits", t.sequence),
    check("visits_range", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "visits_marked_complete_fields",
      sql`${t.status} NOT IN ('completed_pending_confirmation', 'disputed', 'fix_scheduled', 'completed') OR ${t.completedAt} IS NOT NULL`,
    ),
    check(
      "visits_pending_confirmation_fields",
      sql`${t.status} <> 'completed_pending_confirmation' OR ${t.autoConfirmAt} IS NOT NULL`,
    ),
    check(
      "visits_completed_fields",
      sql`${t.status} <> 'completed' OR ${t.confirmedAt} IS NOT NULL`,
    ),
    check(
      "visits_cancelled_fields",
      sql`${t.status} NOT IN ('cancelled_by_customer', 'cancelled_by_business') OR ${t.cancelledAt} IS NOT NULL`,
    ),
  ],
);

export const visitPhotos = pgTable(
  "visit_photos",
  {
    id: id(),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    kind: visitPhotoKind("kind").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    uploadedByUserId: text("uploaded_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [index("visit_photos_visit_kind_idx").on(t.visitId, t.kind)],
);

/**
 * PDF agreement for seasonal / recurring contracts, accepted by both parties
 * (SPEC §10). A changed agreement is a new version.
 */
export const agreements = pgTable(
  "agreements",
  {
    id: id(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
    pdfStorageKey: text("pdf_storage_key").notNull().unique(),
    // SHA-256 (hex) of the PDF, proving which document each party accepted.
    contentSha256: text("content_sha256").notNull(),
    acceptedByCustomerAt: tstz("accepted_by_customer_at"),
    acceptedByBusinessAt: tstz("accepted_by_business_at"),
    acceptedByBusinessUserId: text("accepted_by_business_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (t) => [
    unique("agreements_booking_version_unique").on(t.bookingId, t.version),
    positive("agreements", t.version),
    check("agreements_content_sha256_hex", sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`),
  ],
);
