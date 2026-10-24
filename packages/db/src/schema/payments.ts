import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { bookings, contractPeriods, visits } from "./bookings.ts";
import { businesses } from "./businesses.ts";
import { cents, id, nonNegative, positive, timestamps, tstz } from "./columns.ts";
import { disputes } from "./disputes.ts";
import {
  cardSetupKind,
  cardSetupStatus,
  paymentProvider,
  paymentStatus,
  payoutStatus,
  refundReason,
  refundStatus,
} from "./enums.ts";

/** Weekly Monday payout batch to a business's Stripe Connect account (SPEC §7). */
export const payouts = pgTable(
  "payouts",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    // Inclusive start, exclusive end, as local calendar dates.
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    amountCents: cents("amount_cents").notNull(),
    provider: paymentProvider("provider").notNull().default("stripe"),
    stripeTransferId: text("stripe_transfer_id").unique(),
    status: payoutStatus("status").notNull().default("pending"),
    paidAt: tstz("paid_at"),
    failureMessage: text("failure_message"),
    ...timestamps(),
  },
  (t) => [
    unique("payouts_business_period_unique").on(t.businessId, t.periodStart),
    // Target of composite FKs: money is only swept into its own business's payout.
    unique("payouts_id_business_unique").on(t.id, t.businessId),
    index("payouts_status_idx").on(t.status),
    nonNegative("payouts", t.amountCents),
    check("payouts_period_range", sql`${t.periodEnd} > ${t.periodStart}`),
    check("payouts_paid_fields", sql`${t.status} <> 'paid' OR ${t.paidAt} IS NOT NULL`),
  ],
);

/**
 * A customer charge. Funds are held on the platform until the visit is confirmed
 * (`released_at`), then swept into the business's next weekly payout.
 * `amount_cents` is what the customer pays; the business receives
 * price + price tax − business fee, less what `refunds` returned (each refund records
 * its own price / tax / fee parts and the business-fee reduction).
 *
 * Integrity (composite FKs and the `payments_charge_shape` trigger in custom SQL):
 * `business_id` is the booking's business, `visit_id` belongs to `booking_id`,
 * `payout_id` is a payout of the same business, and a booking is charged in one shape
 * only — per visit (recurring jobs, per-visit snow contracts) or once for the booking
 * (one-off and on-demand jobs, season-priced snow contracts).
 */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    // The booking's business (composite FK), so payouts can only take their own money.
    businessId: uuid("business_id").notNull(),
    // Null for booking-level charges (one-off upfront).
    visitId: uuid("visit_id").references(() => visits.id, { onDelete: "restrict" }),
    // A month of a season-priced snow contract (SPEC §21).
    periodId: uuid("period_id"),
    provider: paymentProvider("provider").notNull().default("stripe"),
    // An upfront season charge is one payment intent shared by one row per month.
    stripePaymentIntentId: text("stripe_payment_intent_id").notNull(),
    stripeChargeId: text("stripe_charge_id").unique(),
    amountCents: cents("amount_cents").notNull(),
    priceCents: cents("price_cents").notNull(),
    serviceFeeCents: cents("service_fee_cents").notNull(),
    priceTaxCents: cents("price_tax_cents").notNull().default(0),
    feeTaxCents: cents("fee_tax_cents").notNull().default(0),
    // Nevile's 3% of the price, deducted from the business's payout.
    businessFeeCents: cents("business_fee_cents").notNull(),
    // Actual Stripe processing cost, once known from the balance transaction.
    processingFeeCents: cents("processing_fee_cents"),
    status: paymentStatus("status").notNull().default("pending"),
    scheduledFor: tstz("scheduled_for"),
    succeededAt: tstz("succeeded_at"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    releasedAt: tstz("released_at"),
    payoutId: uuid("payout_id").references(() => payouts.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    // Target of the composite FK that ties a donation's payment to its booking.
    unique("payments_id_booking_unique").on(t.id, t.bookingId),
    foreignKey({
      name: "payments_booking_business_fk",
      columns: [t.bookingId, t.businessId],
      foreignColumns: [bookings.id, bookings.businessId],
    }).onDelete("restrict"),
    foreignKey({
      name: "payments_visit_booking_fk",
      columns: [t.visitId, t.bookingId],
      foreignColumns: [visits.id, visits.bookingId],
    }).onDelete("restrict"),
    foreignKey({
      name: "payments_period_booking_fk",
      columns: [t.periodId, t.bookingId],
      foreignColumns: [contractPeriods.id, contractPeriods.bookingId],
    }).onDelete("restrict"),
    unique("payments_intent_period_unique")
      .on(t.stripePaymentIntentId, t.periodId)
      .nullsNotDistinct(),
    foreignKey({
      name: "payments_payout_business_fk",
      columns: [t.payoutId, t.businessId],
      foreignColumns: [payouts.id, payouts.businessId],
    }).onDelete("restrict"),
    index("payments_booking_id_idx").on(t.bookingId),
    index("payments_visit_id_idx").on(t.visitId),
    index("payments_period_id_idx").on(t.periodId),
    index("payments_status_idx").on(t.status),
    index("payments_payout_id_idx").on(t.payoutId),
    index("payments_awaiting_payout_idx")
      .on(t.releasedAt)
      .where(sql`${t.payoutId} IS NULL AND ${t.releasedAt} IS NOT NULL`),
    // At most one live charge per visit, and per booking for booking-level charges;
    // failed/cancelled attempts may be retried.
    uniqueIndex("payments_one_live_per_visit_uidx")
      .on(t.visitId)
      .where(sql`${t.visitId} IS NOT NULL AND ${t.status} NOT IN ('failed', 'cancelled')`),
    uniqueIndex("payments_one_live_per_booking_uidx")
      .on(t.bookingId)
      .where(
        sql`${t.visitId} IS NULL AND ${t.periodId} IS NULL AND ${t.status} NOT IN ('failed', 'cancelled')`,
      ),
    uniqueIndex("payments_one_live_per_period_uidx")
      .on(t.periodId)
      .where(sql`${t.periodId} IS NOT NULL AND ${t.status} NOT IN ('failed', 'cancelled')`),
    check("payments_visit_or_period", sql`num_nonnulls(${t.visitId}, ${t.periodId}) <= 1`),
    nonNegative("payments", t.amountCents),
    nonNegative("payments", t.priceCents),
    nonNegative("payments", t.serviceFeeCents),
    nonNegative("payments", t.priceTaxCents),
    nonNegative("payments", t.feeTaxCents),
    nonNegative("payments", t.businessFeeCents),
    nonNegative("payments", t.processingFeeCents),
    check(
      "payments_amount_is_sum",
      sql`${t.amountCents} = ${t.priceCents} + ${t.serviceFeeCents} + ${t.priceTaxCents} + ${t.feeTaxCents}`,
    ),
    check("payments_business_fee_within_price", sql`${t.businessFeeCents} <= ${t.priceCents}`),
  ],
);

/**
 * Money returned on a payment, split like the payment itself (core's `RefundBreakdown`):
 * `amount_cents` = price + service fee + price tax + fee tax refunded. The business's
 * payout for the payment is then (price − Σ price refunded) − (business fee −
 * Σ business-fee reduction) + (price tax − Σ price tax refunded). The
 * `refunds_within_payment` trigger (custom SQL) keeps the live refunds of a payment
 * within what was paid, part by part.
 */
export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    disputeId: uuid("dispute_id").references(() => disputes.id, { onDelete: "restrict" }),
    stripeRefundId: text("stripe_refund_id").unique(),
    amountCents: cents("amount_cents").notNull(),
    // Part of the job price refunded.
    priceCents: cents("price_cents").notNull().default(0),
    // Part of the customer service fee refunded (only on business-initiated
    // cancellations and admin refunds, SPEC §5).
    serviceFeeCents: cents("service_fee_cents").notNull().default(0),
    // Sales tax refunded on the price and on the service fee.
    priceTaxCents: cents("price_tax_cents").notNull().default(0),
    feeTaxCents: cents("fee_tax_cents").notNull().default(0),
    // How much less of the 3% business fee Nevile keeps (it is charged on the retained
    // price only).
    businessFeeAdjustmentCents: cents("business_fee_adjustment_cents").notNull().default(0),
    reason: refundReason("reason").notNull(),
    status: refundStatus("status").notNull().default("pending"),
    initiatedByUserId: text("initiated_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (t) => [
    index("refunds_payment_id_idx").on(t.paymentId),
    index("refunds_dispute_id_idx").on(t.disputeId),
    positive("refunds", t.amountCents),
    nonNegative("refunds", t.priceCents),
    nonNegative("refunds", t.serviceFeeCents),
    nonNegative("refunds", t.priceTaxCents),
    nonNegative("refunds", t.feeTaxCents),
    nonNegative("refunds", t.businessFeeAdjustmentCents),
    check(
      "refunds_amount_is_sum",
      sql`${t.amountCents} = ${t.priceCents} + ${t.serviceFeeCents} + ${t.priceTaxCents} + ${t.feeTaxCents}`,
    ),
  ],
);

/**
 * Tips go 100% to the business; Nevile absorbs the processing cost (SPEC §7), recorded in
 * `processing_fee_cents` for the revenue reports. Composite FKs tie the visit, booking,
 * customer, business and payout together.
 */
export const tips = pgTable(
  "tips",
  {
    id: id(),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id").notNull(),
    customerId: text("customer_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    amountCents: cents("amount_cents").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id").notNull().unique(),
    stripeChargeId: text("stripe_charge_id").unique(),
    // Actual Stripe processing cost of the tip charge (absorbed by Nevile), once known.
    processingFeeCents: cents("processing_fee_cents"),
    status: paymentStatus("status").notNull().default("pending"),
    succeededAt: tstz("succeeded_at"),
    payoutId: uuid("payout_id").references(() => payouts.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "tips_visit_booking_fk",
      columns: [t.visitId, t.bookingId],
      foreignColumns: [visits.id, visits.bookingId],
    }).onDelete("restrict"),
    foreignKey({
      name: "tips_booking_parties_fk",
      columns: [t.bookingId, t.businessId, t.customerId],
      foreignColumns: [bookings.id, bookings.businessId, bookings.customerId],
    }).onDelete("restrict"),
    foreignKey({
      name: "tips_payout_business_fk",
      columns: [t.payoutId, t.businessId],
      foreignColumns: [payouts.id, payouts.businessId],
    }).onDelete("restrict"),
    index("tips_business_created_idx").on(t.businessId, t.createdAt),
    index("tips_payout_id_idx").on(t.payoutId),
    uniqueIndex("tips_one_live_per_visit_uidx")
      .on(t.visitId)
      .where(sql`${t.status} NOT IN ('failed', 'cancelled')`),
    positive("tips", t.amountCents),
    nonNegative("tips", t.processingFeeCents),
  ],
);

/**
 * The payment provider's customer record for a person (SPEC §21), per provider so
 * development's test provider never mixes with Stripe.
 */
export const paymentCustomers = pgTable(
  "payment_customers",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: paymentProvider("provider").notNull(),
    customerId: text("customer_id").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("payment_customers_user_provider_unique").on(t.userId, t.provider),
    unique("payment_customers_provider_customer_unique").on(t.provider, t.customerId),
  ],
);

/**
 * A customer's saved card (SPEC §21): one per person and provider, used for every
 * recurring visit and snow contract charge. Only what's safe to show is kept.
 */
export const savedCards = pgTable(
  "saved_cards",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: paymentProvider("provider").notNull(),
    customerId: text("customer_id").notNull(),
    paymentMethodId: text("payment_method_id").notNull(),
    brand: text("brand").notNull(),
    last4: text("last4").notNull(),
    expMonth: integer("exp_month").notNull(),
    expYear: integer("exp_year").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("saved_cards_user_provider_unique").on(t.userId, t.provider),
    unique("saved_cards_provider_method_unique").on(t.provider, t.paymentMethodId),
    check("saved_cards_last4", sql`${t.last4} ~ '^[0-9]{4}$'`),
    check("saved_cards_exp_month", sql`${t.expMonth} BETWEEN 1 AND 12`),
  ],
);

/** Saving a card on the provider's page (website) or payment sheet (app). */
export const cardSetups = pgTable(
  "card_setups",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: paymentProvider("provider").notNull(),
    kind: cardSetupKind("kind").notNull(),
    providerSetupId: text("provider_setup_id").unique(),
    status: cardSetupStatus("status").notNull().default("open"),
    // Website path to come back to after saving (validated as a local path).
    returnPath: text("return_path"),
    completedAt: tstz("completed_at"),
    ...timestamps(),
  },
  (t) => [
    index("card_setups_user_created_idx").on(t.userId, t.createdAt),
    check(
      "card_setups_return_path_local",
      sql`${t.returnPath} IS NULL OR ${t.returnPath} ~ '^/[^/]'`,
    ),
    check(
      "card_setups_completed_fields",
      sql`${t.status} <> 'completed' OR ${t.completedAt} IS NOT NULL`,
    ),
  ],
);
