import type {
  BookingState,
  CancellationPolicyId,
  DonationKind,
  LedgerEntryKind,
  OnboardingIntent,
  PricingType,
  ProvinceCode,
  RecurrenceFrequency,
  ReferralStatus,
} from "@nevile/core";
import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Enums shared with `@nevile/core` copy its value lists and are checked against the core
 * union types at compile time (type-only imports, so loading the schema never pulls in
 * core at runtime). Use the core types and Zod schemas for them; DB-only enums export
 * their tuples here so the API can build `z.enum(...)` from the same source.
 */

/** Compile-time proof that a tuple has exactly the members of a core union. */
type SameMembers<A, B> = [Exclude<A, B>, Exclude<B, A>] extends [never, never] ? true : false;
type Assert<T extends true> = T;

// ── Shared with @nevile/core ──────────────────────────────────────────────────

const provinceCodes = [
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
type _ProvinceAligned = Assert<SameMembers<(typeof provinceCodes)[number], ProvinceCode>>;
export const province = pgEnum("province", provinceCodes);

const cancellationPolicyIds = ["flexible", "moderate", "strict"] as const;
type _CancellationPolicyAligned = Assert<
  SameMembers<(typeof cancellationPolicyIds)[number], CancellationPolicyId>
>;
export const cancellationPolicy = pgEnum("cancellation_policy", cancellationPolicyIds);

const pricingTypes = ["fixed", "quote"] as const;
type _PricingTypeAligned = Assert<SameMembers<(typeof pricingTypes)[number], PricingType>>;
export const pricingType = pgEnum("pricing_type", pricingTypes);

const recurrenceFrequencies = ["weekly", "biweekly", "monthly"] as const;
type _RecurrenceFrequencyAligned = Assert<
  SameMembers<(typeof recurrenceFrequencies)[number], RecurrenceFrequency>
>;
export const recurrenceFrequency = pgEnum("recurrence_frequency", recurrenceFrequencies);

/**
 * Exactly core's `BOOKING_STATES` (see `transition()` in @nevile/core), so a booking's
 * status can be fed to and persisted from the state machine unchanged. The quote phase
 * (`quote_requested`, `quoted`) is stored on `quote_requests` / `quotes`; a CHECK keeps
 * those two values out of `bookings`.
 */
const bookingStates = [
  "requested",
  "quote_requested",
  "quoted",
  "confirmed",
  "completed_pending_confirmation",
  "disputed",
  "fix_scheduled",
  "completed",
  "cancelled_by_customer",
  "cancelled_by_business",
  "declined",
  "expired",
  "refunded",
] as const;
type _BookingStateAligned = Assert<SameMembers<(typeof bookingStates)[number], BookingState>>;
export const bookingStatus = pgEnum("booking_status", bookingStates);

/**
 * The post-confirmation subset of the booking state machine, tracked per visit so each
 * occurrence of a recurring job or snow contract completes, disputes and pays on its own.
 * A visit exists only once its slot is locked, so it starts at `confirmed`.
 */
export const VISIT_STATUSES = [
  "confirmed",
  "completed_pending_confirmation",
  "disputed",
  "fix_scheduled",
  "completed",
  "refunded",
  "cancelled_by_customer",
  "cancelled_by_business",
] as const satisfies readonly BookingState[];
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export const visitStatus = pgEnum("visit_status", VISIT_STATUSES);

/** Welcome step 1: "I need help at home" / "I run a business" / both (SPEC §16). */
const onboardingIntents = ["customer", "business", "both"] as const;
type _OnboardingIntentAligned = Assert<
  SameMembers<(typeof onboardingIntents)[number], OnboardingIntent>
>;
export const onboardingIntent = pgEnum("onboarding_intent", onboardingIntents);

/** Nevile Neighbours referral lifecycle; transitions are core's `REFERRAL_TRANSITIONS`. */
const referralStatuses = [
  "pending",
  "approved",
  "declined",
  "booked",
  "completed",
  "cancelled",
] as const;
type _ReferralStatusAligned = Assert<
  SameMembers<(typeof referralStatuses)[number], ReferralStatus>
>;
export const communityReferralStatus = pgEnum("community_referral_status", referralStatuses);

/** Checkout donation options; core's `"none"` choice stores no donation row. */
const donationKinds = ["round_up", "preset", "custom"] as const;
type _DonationKindAligned = Assert<
  SameMembers<(typeof donationKinds)[number], Exclude<DonationKind, "none">>
>;
export const donationKind = pgEnum("donation_kind", donationKinds);

/**
 * Community fund ledger entry kinds. The database fixes each kind's sign: donation (+),
 * card fee on a donation (−), payout for a referral job (−), donation refund (−),
 * admin adjustment (±, never 0).
 */
const ledgerEntryKinds = ["donation", "fee", "payout", "refund", "adjustment"] as const;
type _LedgerEntryKindAligned = Assert<
  SameMembers<(typeof ledgerEntryKinds)[number], LedgerEntryKind>
>;
export const communityFundEntryKind = pgEnum("community_fund_entry_kind", ledgerEntryKinds);

// ── DB-only ───────────────────────────────────────────────────────────────────

/** The two sides of the marketplace; one login can act as either (SPEC §1). */
export const PARTY_ROLES = ["customer", "business"] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];
export const partyRole = pgEnum("party_role", PARTY_ROLES);

export const BUSINESS_PLANS = ["free", "pro"] as const;
export type BusinessPlan = (typeof BUSINESS_PLANS)[number];
export const businessPlan = pgEnum("business_plan", BUSINESS_PLANS);

export const BUSINESS_MEMBER_ROLES = ["owner", "manager", "crew"] as const;
export type BusinessMemberRole = (typeof BUSINESS_MEMBER_ROLES)[number];
export const businessMemberRole = pgEnum("business_member_role", BUSINESS_MEMBER_ROLES);

/** Admin review state for insurance documents and new-category requests. */
export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const approvalStatus = pgEnum("approval_status", APPROVAL_STATUSES);

export const BOOKING_KINDS = ["one_off", "recurring", "snow_contract", "on_demand"] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];
export const bookingKind = pgEnum("booking_kind", BOOKING_KINDS);

/**
 * open: awaiting the business · quoted: a quote is out · accepted: a booking was created ·
 * declined: business turned it down · expired · cancelled: withdrawn by the customer.
 * Maps onto core states quote_requested / quoted / confirmed / declined / expired /
 * cancelled_by_customer.
 */
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

/** Whether a snow-contract quote's price is per visit or one price for the season. */
export const SNOW_PRICE_BASES = ["per_visit", "season"] as const;
export type SnowPriceBasis = (typeof SNOW_PRICE_BASES)[number];
export const snowPriceBasis = pgEnum("snow_price_basis", SNOW_PRICE_BASES);

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

/**
 * How a dispute closed: the admin outcomes for an unresolved dispute (SPEC §6.4), or
 * `customer_confirmed` when the customer accepted the work or the fix themselves
 * (core's `confirm_completion` from `disputed` / `fix_scheduled`), with no admin decision.
 */
export const DISPUTE_RESOLUTIONS = [
  "full_payout",
  "partial_refund",
  "full_refund",
  "customer_confirmed",
] as const;
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

/** Staff of a Nevile Neighbours partner organization; coordinators manage the team. */
export const COMMUNITY_PARTNER_ROLES = ["coordinator", "staff"] as const;
export type CommunityPartnerRole = (typeof COMMUNITY_PARTNER_ROLES)[number];
export const communityPartnerRole = pgEnum("community_partner_role", COMMUNITY_PARTNER_ROLES);

export const DONATION_STATUSES = ["pending", "succeeded", "refunded"] as const;
export type DonationStatus = (typeof DONATION_STATUSES)[number];
export const donationStatus = pgEnum("donation_status", DONATION_STATUSES);
