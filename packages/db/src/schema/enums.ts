import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Value lists are exported as `as const` tuples so the API layer can build Zod
 * schemas (`z.enum(BOOKING_STATUSES)`) from the same source as the Postgres enums.
 */

export const PROVINCES = [
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
] as const;
export type Province = (typeof PROVINCES)[number];
export const province = pgEnum("province", PROVINCES);

/** The two sides of the marketplace; one login can act as either (SPEC §1). */
export const PARTY_ROLES = ["customer", "business"] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];
export const partyRole = pgEnum("party_role", PARTY_ROLES);

export const BUSINESS_PLANS = ["free", "pro"] as const;
export type BusinessPlan = (typeof BUSINESS_PLANS)[number];
export const businessPlan = pgEnum("business_plan", BUSINESS_PLANS);

/** SPEC §5 presets: flexible 24h free, moderate 48h free then 50%, strict 7d free then none. */
export const CANCELLATION_POLICIES = ["flexible", "moderate", "strict"] as const;
export type CancellationPolicy = (typeof CANCELLATION_POLICIES)[number];
export const cancellationPolicy = pgEnum("cancellation_policy", CANCELLATION_POLICIES);

export const BUSINESS_MEMBER_ROLES = ["owner", "manager", "crew"] as const;
export type BusinessMemberRole = (typeof BUSINESS_MEMBER_ROLES)[number];
export const businessMemberRole = pgEnum("business_member_role", BUSINESS_MEMBER_ROLES);

/** Admin review state for insurance documents and new-category requests. */
export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const approvalStatus = pgEnum("approval_status", APPROVAL_STATUSES);

export const PRICING_TYPES = ["fixed", "quote"] as const;
export type PricingType = (typeof PRICING_TYPES)[number];
export const pricingType = pgEnum("pricing_type", PRICING_TYPES);

export const BOOKING_KINDS = ["one_off", "recurring", "snow_contract", "on_demand"] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];
export const bookingKind = pgEnum("booking_kind", BOOKING_KINDS);

/**
 * Booking lifecycle (SPEC §4–6):
 * pending_approval → confirmed | declined | expired (24h, no charge)
 * confirmed → awaiting_confirmation (job marked complete, 48h window)
 * awaiting_confirmation → completed (confirmed or auto-confirmed) | disputed
 * disputed → completed (after fix / admin decision)
 * any open state → cancelled (by customer, business or admin)
 * Recurring and contract bookings stay `confirmed` while active; per-visit progress
 * lives on `visits.status`.
 */
export const BOOKING_STATUSES = [
  "pending_approval",
  "confirmed",
  "awaiting_confirmation",
  "disputed",
  "completed",
  "cancelled",
  "declined",
  "expired",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const bookingStatus = pgEnum("booking_status", BOOKING_STATUSES);

export const CANCELLATION_PARTIES = ["customer", "business", "admin"] as const;
export type CancellationParty = (typeof CANCELLATION_PARTIES)[number];
export const cancellationParty = pgEnum("cancellation_party", CANCELLATION_PARTIES);

/** open: awaiting the business; quoted: a quote is out; accepted → booking created. */
export const QUOTE_REQUEST_STATUSES = [
  "open",
  "quoted",
  "accepted",
  "declined",
  "expired",
  "cancelled",
] as const;
export type QuoteRequestStatus = (typeof QUOTE_REQUEST_STATUSES)[number];
export const quoteRequestStatus = pgEnum("quote_request_status", QUOTE_REQUEST_STATUSES);

/** Quotes expire 7 days after being sent if not accepted (SPEC §3). */
export const QUOTE_STATUSES = ["pending", "accepted", "declined", "expired", "withdrawn"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const quoteStatus = pgEnum("quote_status", QUOTE_STATUSES);

export const RECURRENCE_FREQUENCIES = ["weekly", "biweekly", "monthly"] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];
export const recurrenceFrequency = pgEnum("recurrence_frequency", RECURRENCE_FREQUENCIES);

/**
 * Visit lifecycle (SPEC §6): scheduled → awaiting_confirmation (marked complete,
 * customer has 48h) → completed | disputed → resolved (fixed or admin decision).
 */
export const VISIT_STATUSES = [
  "scheduled",
  "awaiting_confirmation",
  "completed",
  "disputed",
  "resolved",
  "cancelled",
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export const visitStatus = pgEnum("visit_status", VISIT_STATUSES);

export const VISIT_PHOTO_KINDS = ["before", "after"] as const;
export type VisitPhotoKind = (typeof VISIT_PHOTO_KINDS)[number];
export const visitPhotoKind = pgEnum("visit_photo_kind", VISIT_PHOTO_KINDS);

export const PAYMENT_STATUSES = [
  "pending",
  "requires_action",
  "processing",
  "succeeded",
  "failed",
  "cancelled",
  "partially_refunded",
  "refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const paymentStatus = pgEnum("payment_status", PAYMENT_STATUSES);

export const REFUND_STATUSES = ["pending", "succeeded", "failed", "cancelled"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
export const refundStatus = pgEnum("refund_status", REFUND_STATUSES);

export const REFUND_REASONS = [
  "customer_cancellation",
  "business_cancellation",
  "dispute_resolution",
  "admin_adjustment",
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];
export const refundReason = pgEnum("refund_reason", REFUND_REASONS);

export const PAYOUT_STATUSES = ["pending", "processing", "paid", "failed"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
export const payoutStatus = pgEnum("payout_status", PAYOUT_STATUSES);

export const DISPUTE_STATUSES = ["open", "fix_scheduled", "escalated", "resolved"] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];
export const disputeStatus = pgEnum("dispute_status", DISPUTE_STATUSES);

/** Admin outcomes for an escalated dispute (SPEC §6.4). */
export const DISPUTE_RESOLUTIONS = ["full_payout", "partial_refund", "full_refund"] as const;
export type DisputeResolution = (typeof DISPUTE_RESOLUTIONS)[number];
export const disputeResolution = pgEnum("dispute_resolution", DISPUTE_RESOLUTIONS);

/** Mirrors Stripe Billing subscription statuses. */
export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "paused",
  "unpaid",
  "canceled",
  "incomplete",
  "incomplete_expired",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const subscriptionStatus = pgEnum("subscription_status", SUBSCRIPTION_STATUSES);

export const PUSH_PLATFORMS = ["ios", "android", "web"] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];
export const pushPlatform = pgEnum("push_platform", PUSH_PLATFORMS);
