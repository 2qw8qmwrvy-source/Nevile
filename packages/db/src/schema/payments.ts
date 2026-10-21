import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { bookings, visits } from "./bookings.ts";
import { businesses } from "./businesses.ts";
import { cents, id, nonNegative, positive, timestamps, tstz } from "./columns.ts";
import { disputes } from "./disputes.ts";
import { paymentStatus, payoutStatus, refundReason, refundStatus } from "./enums.ts";

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
    stripeTransferId: text("stripe_transfer_id").unique(),
    status: payoutStatus("status").notNull().default("pending"),
    paidAt: tstz("paid_at"),
    failureMessage: text("failure_message"),
    ...timestamps(),
  },
  (t) => [
    unique("payouts_business_period_unique").on(t.businessId, t.periodStart),
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
 * price + price tax − business fee.
 */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    // Null for booking-level charges (one-off upfront, season-priced contract).
    visitId: uuid("visit_id").references(() => visits.id, { onDelete: "restrict" }),
    stripePaymentIntentId: text("stripe_payment_intent_id").notNull().unique(),
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
    index("payments_booking_id_idx").on(t.bookingId),
    index("payments_visit_id_idx").on(t.visitId),
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
      .where(sql`${t.visitId} IS NULL AND ${t.status} NOT IN ('failed', 'cancelled')`),
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
    // Portion of the refund that is the customer service fee (only refunded on
    // business-initiated cancellations, SPEC §5).
    serviceFeeCents: cents("service_fee_cents").notNull().default(0),
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
    nonNegative("refunds", t.serviceFeeCents),
    check("refunds_fee_within_amount", sql`${t.serviceFeeCents} <= ${t.amountCents}`),
  ],
);

/** Tips go 100% to the business; Nevile absorbs the processing cost (SPEC §7). */
export const tips = pgTable(
  "tips",
  {
    id: id(),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "restrict" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    amountCents: cents("amount_cents").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id").notNull().unique(),
    status: paymentStatus("status").notNull().default("pending"),
    payoutId: uuid("payout_id").references(() => payouts.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    index("tips_business_created_idx").on(t.businessId, t.createdAt),
    index("tips_payout_id_idx").on(t.payoutId),
    uniqueIndex("tips_one_live_per_visit_uidx")
      .on(t.visitId)
      .where(sql`${t.status} NOT IN ('failed', 'cancelled')`),
    positive("tips", t.amountCents),
  ],
);
