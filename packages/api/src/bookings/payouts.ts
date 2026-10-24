import { canTakeBookings } from "@nevile/core";
import {
  and,
  type Business,
  bookingCheckouts,
  businesses,
  desc,
  eq,
  inArray,
  isNull,
  payments,
  payouts,
  sql,
} from "@nevile/db";
import type { PaymentEvent } from "@nevile/payments";
import { TRPCError } from "@trpc/server";
import { type BookingDeps, completeAppCheckout, completeCheckout } from "./flows.ts";

/** Acts on a verified provider notification (webhook, or the fake provider's pages). */
export async function handlePaymentEvent(deps: BookingDeps, event: PaymentEvent): Promise<void> {
  switch (event.type) {
    case "checkout_completed":
      await completeCheckout(deps, event.sessionId);
      return;
    case "checkout_expired":
      await deps.db
        .update(bookingCheckouts)
        .set({ status: "expired" })
        .where(
          and(
            eq(bookingCheckouts.providerSessionId, event.sessionId),
            eq(bookingCheckouts.status, "open"),
          ),
        );
      return;
    case "payment_succeeded":
    case "payment_authorized": {
      // In-app payments (SPEC §20); Checkout's own intents have no checkout row yet.
      const [checkout] = await deps.db
        .select({ id: bookingCheckouts.id })
        .from(bookingCheckouts)
        .where(eq(bookingCheckouts.providerPaymentIntentId, event.paymentIntentId))
        .limit(1);
      if (checkout) await completeAppCheckout(deps, checkout.id);
      return;
    }
    case "account_updated":
      await deps.db
        .update(businesses)
        .set({ payoutsEnabled: event.payoutsEnabled })
        .where(eq(businesses.stripeAccountId, event.accountId));
      return;
    case "ignored":
      return;
  }
}

/** Opens (or resumes) the provider's payout setup for a business (SPEC §19). */
export async function startPayoutSetup(
  deps: BookingDeps,
  business: Business,
  email: string | null,
): Promise<{ url: string }> {
  let accountId = business.stripeAccountId;
  if (!accountId) {
    ({ accountId } = await deps.payments.createAccount({ businessId: business.id, email }));
    await deps.db
      .update(businesses)
      .set({ stripeAccountId: accountId })
      .where(eq(businesses.id, business.id));
  }
  const page = `${deps.config.siteUrl}/business/payouts`;
  return deps.payments.onboardingLink({
    accountId,
    returnUrl: `${page}?done=1`,
    refreshUrl: `${page}?retry=1`,
  });
}

/** Re-reads payout readiness from the provider (after the business returns from setup). */
export async function refreshPayoutStatus(deps: BookingDeps, business: Business): Promise<boolean> {
  if (!business.stripeAccountId) return false;
  const account = await deps.payments.getAccount(business.stripeAccountId);
  if (account.payoutsEnabled !== business.payoutsEnabled) {
    await deps.db
      .update(businesses)
      .set({ payoutsEnabled: account.payoutsEnabled })
      .where(eq(businesses.id, business.id));
  }
  return account.payoutsEnabled;
}

/** What the payouts page shows. */
export async function payoutSummary(deps: BookingDeps, business: Business) {
  const now = deps.now();
  const owed =
    sql<number>`coalesce(sum(${payments.priceCents} + ${payments.priceTaxCents} - ${payments.businessFeeCents}), 0)`.mapWith(
      Number,
    );
  const [waiting] = await deps.db
    .select({ cents: owed })
    .from(payments)
    .where(
      and(
        eq(payments.businessId, business.id),
        inArray(payments.status, ["succeeded"]),
        isNull(payments.payoutId),
      ),
    );
  const recent = await deps.db
    .select()
    .from(payouts)
    .where(eq(payouts.businessId, business.id))
    .orderBy(desc(payouts.createdAt))
    .limit(10);
  return {
    hasAccount: business.stripeAccountId !== null,
    payoutsEnabled: business.payoutsEnabled,
    setupDueAt: business.payoutSetupDueAt,
    bookingsPaused: !canTakeBookings({
      payoutsEnabled: business.payoutsEnabled,
      payoutSetupDueAt: business.payoutSetupDueAt,
      now,
    }),
    /** Paid jobs not yet paid out (before refunds), in cents. */
    upcomingCents: waiting?.cents ?? 0,
    payouts: recent.map((payout) => ({
      id: payout.id,
      periodStart: payout.periodStart,
      periodEnd: payout.periodEnd,
      amountCents: payout.amountCents,
      status: payout.status,
      paidAt: payout.paidAt,
    })),
  };
}

export function assertOwner(role: string): void {
  if (role !== "owner") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can set up payouts." });
  }
}
