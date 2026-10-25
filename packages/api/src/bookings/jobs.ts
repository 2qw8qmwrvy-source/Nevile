import { addCalendarDays, formatIsoDate, MS_PER_DAY, payoutBatchOn, toLocal } from "@nevile/core";
import {
  and,
  type Business,
  bookings,
  businesses,
  disputes,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  payments,
  payouts,
  refunds,
  sql,
} from "@nevile/db";
import { lazyStorage, type MediaStorage } from "@nevile/storage";
import { emailUnreadMessages } from "../chat/flows.ts";
import { sendAll } from "../notify.ts";
import { chargeOngoing, releaseSeasonMonths } from "../ongoing/charges.ts";
import { endSeries, finishSeries, remindVisits } from "../ongoing/recurring.ts";
import { endContract, finishContracts } from "../ongoing/snow.ts";
import { cleanUpUnattachedPhotos } from "../photos.ts";
import { defaultPushSender, deliverPendingNotifications } from "../push.ts";
import { expireQuoteRequests } from "../quotes/flows.ts";
import { businessEmails, businessTeamEmails } from "./emails.ts";
import {
  autoConfirmJobs,
  type BookingDeps,
  cancelByBusiness,
  endRequest,
  expireCheckouts,
} from "./flows.ts";

/** Reminder this long before the payout-setup deadline. */
const PAYOUT_REMINDER_BEFORE_MS = 2 * MS_PER_DAY;

/** Approval requests whose 24 hours (or window start) passed. */
async function expireRequests(deps: BookingDeps): Promise<number> {
  const due = await deps.db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.status, "requested"), lte(bookings.approvalExpiresAt, deps.now())));
  let expired = 0;
  for (const booking of due) {
    await endRequest(deps, booking.id, { by: "system" });
    expired += 1;
  }
  return expired;
}

/** Disputes whose 3-day fix window ended go to Nevile staff (SPEC §6). */
async function escalateDisputes(deps: BookingDeps): Promise<number> {
  const now = deps.now();
  const escalated = await deps.db
    .update(disputes)
    .set({ status: "escalated", escalatedAt: now })
    .where(and(inArray(disputes.status, ["open", "fix_scheduled"]), lte(disputes.fixDeadline, now)))
    .returning({ id: disputes.id, visitId: disputes.visitId, reason: disputes.reason });
  if (escalated.length > 0 && deps.config.opsEmail) {
    await sendAll(deps.email, [
      {
        to: deps.config.opsEmail,
        subject: `${escalated.length} dispute(s) need a decision`,
        text: escalated
          .map((dispute) => `Dispute ${dispute.id} (visit ${dispute.visitId}): ${dispute.reason}`)
          .join("\n"),
      },
    ]);
  }
  return escalated.length;
}

const dueLabel = (due: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(due);

/**
 * Payout setup (SPEC §19): a reminder two days before the deadline; at the deadline,
 * upcoming bookings are cancelled with a full refund and new ones pause.
 */
async function enforcePayoutSetup(
  deps: BookingDeps,
): Promise<{ reminded: number; enforced: number }> {
  const now = deps.now();
  const pending = await deps.db
    .select()
    .from(businesses)
    .where(and(eq(businesses.payoutsEnabled, false), isNotNull(businesses.payoutSetupDueAt)));
  let reminded = 0;
  let enforced = 0;
  for (const business of pending) {
    const due = business.payoutSetupDueAt as Date;
    if (due.getTime() <= now.getTime()) {
      if (business.payoutSetupEnforcedAt && business.payoutSetupEnforcedAt >= due) continue;
      enforced += 1;
      const cancelled = await cancelUpcoming(deps, business);
      await deps.db
        .update(businesses)
        .set({ payoutSetupEnforcedAt: now })
        .where(eq(businesses.id, business.id));
      await sendAll(
        deps.email,
        businessEmails.payoutSetupEnforced(
          await businessTeamEmails(deps.db, business.id),
          deps.config.siteUrl,
          cancelled,
        ),
      );
    } else if (
      !business.payoutSetupReminderSentAt &&
      due.getTime() - now.getTime() <= PAYOUT_REMINDER_BEFORE_MS
    ) {
      reminded += 1;
      await deps.db
        .update(businesses)
        .set({ payoutSetupReminderSentAt: now })
        .where(eq(businesses.id, business.id));
      await sendAll(
        deps.email,
        businessEmails.payoutSetupReminder(
          await businessTeamEmails(deps.db, business.id),
          deps.config.siteUrl,
          dueLabel(due, business.timezone),
        ),
      );
    }
  }
  return { reminded, enforced };
}

/**
 * Cancels (full refund) a business's upcoming jobs, ends its running series and snow
 * contracts (as if the business ended them) and declines its open requests.
 */
async function cancelUpcoming(deps: BookingDeps, business: Business): Promise<number> {
  const now = deps.now();
  const upcoming = await deps.db
    .select({ id: bookings.id, status: bookings.status, kind: bookings.kind })
    .from(bookings)
    .where(
      and(
        eq(bookings.businessId, business.id),
        inArray(bookings.status, ["confirmed", "requested"]),
        or(
          gt(bookings.requestedStartsAt, now),
          inArray(bookings.kind, ["recurring", "snow_contract"]),
        ),
      ),
    );
  const reason = "The pro didn't finish setting up payments on Nevile in time.";
  for (const booking of upcoming) {
    if (booking.status === "requested") {
      await endRequest(deps, booking.id, { by: "system" }).catch((error) =>
        console.error("[jobs] could not end request", booking.id, error),
      );
    } else if (booking.kind === "snow_contract") {
      await endContract(deps, booking.id, { by: "business", actorUserId: null, reason }).catch(
        (error) => console.error("[jobs] could not end contract", booking.id, error),
      );
    } else if (booking.kind === "recurring") {
      await endSeries(deps, booking.id, { by: "business", actorUserId: null, reason }).catch(
        (error) => console.error("[jobs] could not end series", booking.id, error),
      );
    } else {
      await cancelByBusiness(deps, booking.id, { actorUserId: null, reason }).catch((error) =>
        console.error("[jobs] could not cancel booking", booking.id, error),
      );
    }
  }
  return upcoming.length;
}

/**
 * Monday payouts (SPEC §7): every released payment confirmed before this week's cutoff
 * and not yet paid out, one transfer per business. Re-running is safe: a payout row is
 * created once per business and period, and its transfer uses the payout id as the
 * idempotency key; failed transfers are retried on the next run.
 */
export async function runPayouts(deps: BookingDeps): Promise<{ paid: number; failed: number }> {
  const now = deps.now();
  const local = toLocal(now, "America/Halifax");
  const today = { year: local.year, month: local.month, day: local.day };
  const lastMonday = addCalendarDays(today, -((local.weekday + 6) % 7));
  const batch = payoutBatchOn(formatIsoDate(lastMonday));
  const periodStart = formatIsoDate(addCalendarDays(lastMonday, -7));

  const ready = await deps.db
    .select({ business: businesses })
    .from(businesses)
    .where(and(eq(businesses.payoutsEnabled, true), isNotNull(businesses.stripeAccountId)));
  for (const { business } of ready) {
    await deps.db.transaction(async (tx) => {
      const owed = await tx
        .select({
          id: payments.id,
          amount:
            sql<number>`${payments.priceCents} + ${payments.priceTaxCents} - ${payments.businessFeeCents}
            - coalesce((SELECT sum(${refunds.priceCents} + ${refunds.priceTaxCents} - ${refunds.businessFeeAdjustmentCents})
                        FROM ${refunds} WHERE ${refunds.paymentId} = ${payments.id} AND ${refunds.status} = 'succeeded'), 0)`.mapWith(
              Number,
            ),
        })
        .from(payments)
        .where(
          and(
            eq(payments.businessId, business.id),
            inArray(payments.status, ["succeeded", "partially_refunded"]),
            isNotNull(payments.releasedAt),
            lt(payments.releasedAt, batch.cutoffAt),
            isNull(payments.payoutId),
          ),
        )
        .for("update");
      const total = owed.reduce((sum, payment) => sum + Math.max(0, payment.amount), 0);
      if (owed.length === 0 || total <= 0) return;
      const [payout] = await tx
        .insert(payouts)
        .values({
          businessId: business.id,
          periodStart,
          periodEnd: batch.payoutDate,
          amountCents: total,
          provider: deps.payments.name,
          status: "processing",
        })
        .onConflictDoNothing({ target: [payouts.businessId, payouts.periodStart] })
        .returning({ id: payouts.id });
      if (!payout) return;
      await tx
        .update(payments)
        .set({ payoutId: payout.id })
        .where(
          inArray(
            payments.id,
            owed.map((payment) => payment.id),
          ),
        );
    });
  }

  // Send every payout that hasn't gone out yet (new ones and earlier failures).
  const unsent = await deps.db
    .select({ payout: payouts, accountId: businesses.stripeAccountId })
    .from(payouts)
    .innerJoin(businesses, eq(businesses.id, payouts.businessId))
    .where(or(eq(payouts.status, "processing"), eq(payouts.status, "failed")));
  let paid = 0;
  let failed = 0;
  for (const { payout, accountId } of unsent) {
    if (!accountId) continue;
    try {
      const { transferId } = await deps.payments.transfer({
        accountId,
        amountCents: payout.amountCents,
        idempotencyKey: `payout-${payout.id}`,
        description: `Nevile payout for ${payout.periodStart} to ${payout.periodEnd}`,
      });
      await deps.db
        .update(payouts)
        .set({
          status: "paid",
          paidAt: deps.now(),
          stripeTransferId: transferId,
          failureMessage: null,
        })
        .where(eq(payouts.id, payout.id));
      paid += 1;
    } catch (error) {
      failed += 1;
      await deps.db
        .update(payouts)
        .set({
          status: "failed",
          failureMessage: error instanceof Error ? error.message.slice(0, 500) : "transfer failed",
        })
        .where(eq(payouts.id, payout.id));
    }
  }
  return { paid, failed };
}

export type JobsReport = Record<string, number | string>;

/**
 * Every timer in one idempotent pass (SPEC §19), run every few minutes by the host's
 * scheduler. One failing step doesn't stop the others; its error is reported.
 */
export async function runScheduledJobs(
  deps: BookingDeps,
  storage: MediaStorage = lazyStorage,
): Promise<JobsReport> {
  const report: JobsReport = {};
  const steps: Array<[string, () => Promise<number | Record<string, number>>]> = [
    ["checkoutsExpired", () => expireCheckouts(deps)],
    ["requestsExpired", () => expireRequests(deps)],
    ["jobsAutoConfirmed", () => autoConfirmJobs(deps)],
    // Recurring jobs and snow contracts (SPEC §21), before payouts so they include them.
    ["ongoingCharges", () => chargeOngoing(deps)],
    ["seasonMonthsReleased", () => releaseSeasonMonths(deps)],
    ["visitsReminded", () => remindVisits(deps)],
    ["seriesFinished", () => finishSeries(deps)],
    ["contractsFinished", () => finishContracts(deps)],
    ["disputesEscalated", () => escalateDisputes(deps)],
    ["payoutSetup", () => enforcePayoutSetup(deps)],
    ["payouts", () => runPayouts(deps)],
    // Quotes and chat (SPEC §20).
    ["quoteRequestsClosed", () => expireQuoteRequests(deps)],
    ["unreadChatEmails", () => emailUnreadMessages(deps)],
    ["photosCleanedUp", () => cleanUpUnattachedPhotos(deps.db, storage, deps.now())],
    // Anything a crashed request didn't push yet.
    [
      "pushesDelivered",
      () =>
        deliverPendingNotifications({
          db: deps.db,
          push: deps.push ?? defaultPushSender,
          now: deps.now,
        }),
    ],
  ];
  for (const [name, step] of steps) {
    try {
      const result = await step();
      if (typeof result === "number") report[name] = result;
      else for (const [key, value] of Object.entries(result)) report[`${name}.${key}`] = value;
    } catch (error) {
      console.error(`[jobs] ${name} failed`, error);
      report[`${name}.error`] = error instanceof Error ? error.message : String(error);
    }
  }
  return report;
}
