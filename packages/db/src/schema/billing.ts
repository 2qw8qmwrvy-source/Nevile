import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { businesses } from "./businesses.ts";
import { cents, createdAt, id, nonNegative, timestamps, tstz } from "./columns.ts";
import { businessPlan, subscriptionStatus } from "./enums.ts";

/** Stripe Billing subscription for the Pro plan; pausable in the off-season (SPEC §8). */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripePriceId: text("stripe_price_id"),
    plan: businessPlan("plan").notNull(),
    status: subscriptionStatus("status").notNull(),
    currentPeriodEnd: tstz("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    pausedUntil: tstz("paused_until"),
    canceledAt: tstz("canceled_at"),
    ...timestamps(),
  },
  (t) => [
    index("subscriptions_business_id_idx").on(t.businessId),
    uniqueIndex("subscriptions_one_live_per_business_uidx")
      .on(t.businessId)
      .where(sql`${t.status} NOT IN ('canceled', 'incomplete_expired')`),
  ],
);

/** Admin-configurable plan pricing (Pro ≈ $29/month); one active price per plan. */
export const planPrices = pgTable(
  "plan_prices",
  {
    id: id(),
    plan: businessPlan("plan").notNull(),
    monthlyAmountCents: cents("monthly_amount_cents").notNull(),
    stripePriceId: text("stripe_price_id").unique(),
    active: boolean("active").notNull().default(true),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("plan_prices_one_active_per_plan_uidx")
      .on(t.plan)
      .where(sql`${t.active}`),
    nonNegative("plan_prices", t.monthlyAmountCents),
  ],
);
