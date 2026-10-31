import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { bookings } from "./bookings.ts";
import { serviceCategories } from "./catalog.ts";
import {
  cents,
  createdAt,
  id,
  nonNegative,
  positive,
  postalCodeCheck,
  slugCheck,
  timestamps,
  tstz,
} from "./columns.ts";
import {
  communityFundEntryKind,
  communityPartnerRole,
  communityReferralStatus,
  donationKind,
  donationStatus,
} from "./enums.ts";
import { payments } from "./payments.ts";

/**
 * Nevile Neighbours (SPEC §15). Region ids are kebab-case slugs from core's region list
 * (`NS_REGIONS`, e.g. `halifax-regional-municipality`). Only their format is checked here:
 * the launch province is not a database rule, so new regions need no migration.
 */

/** A registered local organization (seniors' centre, support agency, faith group). */
export const communityPartners = pgTable(
  "community_partners",
  {
    id: id(),
    name: text("name").notNull(),
    // Free-form organization type, e.g. "seniors_centre", "support_agency", "faith_group".
    kind: text("kind").notNull(),
    contactEmail: text("contact_email").notNull(),
    regionId: text("region_id").notNull(),
    active: boolean("active").notNull().default(true),
    // Admin who added the partner.
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (t) => [
    index("community_partners_active_name_idx").on(t.active, t.name),
    slugCheck("community_partners", t.regionId),
  ],
);

/** Partner staff who may submit referrals; coordinators manage the partner's team. */
export const communityPartnerMembers = pgTable(
  "community_partner_members",
  {
    id: id(),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => communityPartners.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: communityPartnerRole("role").notNull().default("staff"),
    ...timestamps(),
  },
  (t) => [
    unique("community_partner_members_partner_user_unique").on(t.partnerId, t.userId),
    index("community_partner_members_user_id_idx").on(t.userId),
  ],
);

/**
 * A partner's request for help for a homeowner. Data is deliberately minimal: no health,
 * disability, age or income details, and contact goes through the partner
 * (`contact_route`). The partner confirms the homeowner consented before submitting.
 * Once booked, the job runs as a normal booking paid from the community fund.
 */
export const communityReferrals = pgTable(
  "community_referrals",
  {
    id: id(),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => communityPartners.id, { onDelete: "restrict" }),
    submittedByUserId: text("submitted_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    homeownerFirstName: text("homeowner_first_name").notNull(),
    // How to reach the homeowner through the partner, e.g. "call Mary at the centre".
    contactRoute: text("contact_route").notNull(),
    addressLine: text("address_line").notNull(),
    city: text("city").notNull(),
    postalCode: text("postal_code").notNull(),
    regionId: text("region_id").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => serviceCategories.id, { onDelete: "restrict" }),
    preferredTiming: text("preferred_timing"),
    notes: text("notes"),
    consentConfirmedAt: tstz("consent_confirmed_at").notNull(),
    status: communityReferralStatus("status").notNull().default("pending"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: tstz("reviewed_at"),
    declineReason: text("decline_reason"),
    // The job booked for this referral (one booking serves one referral).
    bookingId: uuid("booking_id")
      .unique()
      .references(() => bookings.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    index("community_referrals_status_idx").on(t.status),
    index("community_referrals_partner_created_idx").on(t.partnerId, t.createdAt),
    index("community_referrals_category_id_idx").on(t.categoryId),
    postalCodeCheck("community_referrals", t.postalCode),
    slugCheck("community_referrals", t.regionId),
    // An admin decided every referral past `pending`; a partner may withdraw a pending one.
    check(
      "community_referrals_reviewed",
      sql`${t.status} IN ('pending', 'cancelled') OR ${t.reviewedAt} IS NOT NULL`,
    ),
    check(
      "community_referrals_decline_reason",
      sql`${t.status} <> 'declined' OR ${t.declineReason} IS NOT NULL`,
    ),
    check(
      "community_referrals_booking",
      sql`CASE WHEN ${t.status} IN ('booked', 'completed') THEN ${t.bookingId} IS NOT NULL
        WHEN ${t.status} IN ('pending', 'approved', 'declined') THEN ${t.bookingId} IS NULL
        ELSE true END`,
    ),
  ],
);

/** The biggest round-up: a whole-dollar total rounds up by a full $1 (SPEC §15). */
export const MAX_ROUND_UP_CENTS = 100;

/**
 * An optional checkout donation (SPEC §15). It rides on the booking's card charge but is
 * not part of `payments.amount_cents` (the job charge), so the Stripe charge is the
 * payment's amount plus its donation. The card fee is taken from the donation itself
 * (`net_cents` reaches the fund). Never Nevile revenue, never taxed.
 *
 * Composite FKs: the donor is the booking's customer, and the payment is the booking's.
 */
export const donations = pgTable(
  "donations",
  {
    id: id(),
    donorUserId: text("donor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "restrict" }),
    paymentId: uuid("payment_id")
      .unique()
      .references(() => payments.id, { onDelete: "restrict" }),
    kind: donationKind("kind").notNull(),
    amountCents: cents("amount_cents").notNull(),
    // Card processing fee deducted from the donation (2.9%, rounded half-up).
    feeCents: cents("fee_cents").notNull(),
    netCents: cents("net_cents").notNull(),
    status: donationStatus("status").notNull().default("pending"),
    succeededAt: tstz("succeeded_at"),
    refundedAt: tstz("refunded_at"),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "donations_booking_customer_fk",
      columns: [t.bookingId, t.donorUserId],
      foreignColumns: [bookings.id, bookings.customerId],
    }).onDelete("restrict"),
    foreignKey({
      name: "donations_payment_booking_fk",
      columns: [t.paymentId, t.bookingId],
      foreignColumns: [payments.id, payments.bookingId],
    }).onDelete("restrict"),
    index("donations_donor_created_idx").on(t.donorUserId, t.createdAt),
    index("donations_booking_id_idx").on(t.bookingId),
    positive("donations", t.amountCents),
    nonNegative("donations", t.feeCents),
    nonNegative("donations", t.netCents),
    check(
      "donations_net_is_amount_less_fee",
      sql`${t.netCents} = ${t.amountCents} - ${t.feeCents}`,
    ),
    check(
      "donations_round_up_range",
      sql`${t.kind} <> 'round_up' OR ${t.amountCents} <= ${sql.raw(String(MAX_ROUND_UP_CENTS))}`,
    ),
    // A payment always belongs to a booking, so the composite FK above is never skipped.
    check(
      "donations_payment_has_booking",
      sql`${t.paymentId} IS NULL OR ${t.bookingId} IS NOT NULL`,
    ),
    check(
      "donations_status_fields",
      sql`(${t.status} = 'pending' OR ${t.succeededAt} IS NOT NULL) AND (${t.status} <> 'refunded' OR ${t.refundedAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * Append-only community fund ledger (SPEC §15): every donation, card fee, payout and
 * refund is one row, and the fund balance is `SUM(amount_cents)`, never stored.
 * Triggers (custom SQL) reject UPDATE, DELETE and TRUNCATE, check that donation entries
 * match their donation, that a payout is for its referral's booking, and that a payout
 * never takes the balance below zero. Like `audit_log`, `created_by_user_id` has no
 * foreign key so history outlives accounts; null means the system.
 */
export const communityFundLedger = pgTable(
  "community_fund_ledger",
  {
    id: id(),
    kind: communityFundEntryKind("kind").notNull(),
    // Signed: money into the fund is positive, money out negative.
    amountCents: cents("amount_cents").notNull(),
    donationId: uuid("donation_id").references(() => donations.id, { onDelete: "restrict" }),
    referralId: uuid("referral_id").references(() => communityReferrals.id, {
      onDelete: "restrict",
    }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "restrict" }),
    memo: text("memo"),
    createdByUserId: text("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("community_fund_ledger_created_at_idx").on(t.createdAt),
    index("community_fund_ledger_donation_id_idx").on(t.donationId),
    index("community_fund_ledger_referral_id_idx").on(t.referralId),
    index("community_fund_ledger_booking_id_idx").on(t.bookingId),
    // A donation is credited, charged its fee and refunded at most once each.
    uniqueIndex("community_fund_ledger_one_per_donation_kind_uidx")
      .on(t.donationId, t.kind)
      .where(sql`${t.kind} IN ('donation', 'fee', 'refund')`),
    check(
      "community_fund_ledger_amount_sign",
      sql`CASE ${t.kind} WHEN 'donation' THEN ${t.amountCents} > 0
        WHEN 'adjustment' THEN ${t.amountCents} <> 0
        ELSE ${t.amountCents} < 0 END`,
    ),
    check(
      "community_fund_ledger_links",
      sql`CASE WHEN ${t.kind} IN ('donation', 'fee', 'refund')
          THEN ${t.donationId} IS NOT NULL AND ${t.referralId} IS NULL
        WHEN ${t.kind} = 'payout'
          THEN ${t.referralId} IS NOT NULL AND ${t.bookingId} IS NOT NULL AND ${t.donationId} IS NULL
        ELSE true END`,
    ),
    check(
      "community_fund_ledger_adjustment_memo",
      sql`${t.kind} <> 'adjustment' OR (${t.memo} IS NOT NULL AND btrim(${t.memo}) <> '')`,
    ),
  ],
);
