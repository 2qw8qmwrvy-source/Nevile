/**
 * Charging saved cards for ongoing work (SPEC §21): recurring visits 3 days before,
 * per-visit snow visits once confirmed, and season months (upfront or monthly). A failed
 * charge is retried daily for 3 days; then the booking pauses. Updating the card retries
 * what's owed at once and resumes the booking.
 */
import { contactEmail } from "@nevile/auth";
import {
  BUSINESS_FEE_BPS,
  nextChargeRetryAt,
  percentOf,
  recurringPaymentDeadline,
} from "@nevile/core";
import {
  and,
  asc,
  type Booking,
  bookings,
  type ContractPeriod,
  contractPeriods,
  type DbExecutor,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  payments,
  snowContracts,
  user,
  visits,
} from "@nevile/db";
import { emailsTo } from "../bookings/emails.ts";
import { type BookingDeps, pushNotifications } from "../bookings/flows.ts";
import { savedCardOf } from "../cards/flows.ts";
import { businessTeamUserIds, NOTIFICATION_TYPES, notify } from "../inbox.ts";
import { sendAll } from "../notify.ts";

/** Payment states that hold or collected money (anything else may be retried). */
const LIVE = ["pending", "authorized", "succeeded", "partially_refunded", "refunded"] as const;

export type Amounts = {
  priceCents: number;
  serviceFeeCents: number;
  priceTaxCents: number;
  feeTaxCents: number;
};

/** One charge: a visit of an ongoing booking, or one or more months of a season price. */
export type ChargeTarget =
  | {
      kind: "visit";
      booking: Booking;
      visitId: string;
      /** Snow visits are already confirmed: release the money for the next payout. */
      releaseNow: boolean;
      /** What to charge instead of the booking's per-visit amounts (a late skip). */
      amounts?: Amounts;
      description: string;
    }
  | { kind: "periods"; booking: Booking; periods: ContractPeriod[]; description: string };

export type ChargeOutcome = "succeeded" | "failed";

const sumAmounts = (rows: Amounts[]): Amounts =>
  rows.reduce(
    (total, row) => ({
      priceCents: total.priceCents + row.priceCents,
      serviceFeeCents: total.serviceFeeCents + row.serviceFeeCents,
      priceTaxCents: total.priceTaxCents + row.priceTaxCents,
      feeTaxCents: total.feeTaxCents + row.feeTaxCents,
    }),
    { priceCents: 0, serviceFeeCents: 0, priceTaxCents: 0, feeTaxCents: 0 },
  );

const totalOf = (a: Amounts) => a.priceCents + a.serviceFeeCents + a.priceTaxCents + a.feeTaxCents;

/**
 * Charges the customer's saved card once for the target, recording one payment row per
 * visit or month (an upfront season charge shares its payment intent across months).
 */
export async function chargeTarget(
  deps: BookingDeps,
  target: ChargeTarget,
): Promise<ChargeOutcome> {
  const { booking } = target;
  const now = deps.now();
  const rows: Array<Amounts & { visitId: string | null; periodId: string | null }> =
    target.kind === "visit"
      ? [
          {
            ...(target.amounts ?? {
              priceCents: booking.priceCents,
              serviceFeeCents: booking.serviceFeeCents,
              priceTaxCents: booking.priceTaxCents,
              feeTaxCents: booking.feeTaxCents,
            }),
            visitId: target.visitId,
            periodId: null,
          },
        ]
      : target.periods.map((period) => ({
          priceCents: period.priceCents,
          serviceFeeCents: period.serviceFeeCents,
          priceTaxCents: period.priceTaxCents,
          feeTaxCents: period.feeTaxCents,
          visitId: null,
          periodId: period.id,
        }));
  if (rows.length === 0) return "succeeded";
  const inserted = await deps.db
    .insert(payments)
    .values(
      rows.map((row, index) => ({
        bookingId: booking.id,
        businessId: booking.businessId,
        visitId: row.visitId,
        periodId: row.periodId,
        provider: deps.payments.name,
        // Replaced by the provider's payment id once it answers.
        stripePaymentIntentId: `pending_${crypto.randomUUID()}_${index}`,
        amountCents: totalOf(row),
        priceCents: row.priceCents,
        serviceFeeCents: row.serviceFeeCents,
        priceTaxCents: row.priceTaxCents,
        feeTaxCents: row.feeTaxCents,
        businessFeeCents: percentOf(row.priceCents, BUSINESS_FEE_BPS),
        status: "pending" as const,
        scheduledFor: now,
        // Retries are measured from here, on the app's clock.
        createdAt: now,
      })),
    )
    .returning({ id: payments.id });
  const ids = inserted.map((row) => row.id);
  const reference = ids[0] ?? crypto.randomUUID();

  const card = await savedCardOf(deps.db, booking.customerId, deps.payments.name);
  const [customer] = await deps.db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, booking.customerId));
  const result = card
    ? await deps.payments
        .chargeSavedCard({
          reference,
          customerId: card.customerId,
          paymentMethodId: card.paymentMethodId,
          amountCents: totalOf(sumAmounts(rows)),
          customerEmail: contactEmail(customer?.email),
          description: target.description,
          metadata: { bookingId: booking.id, businessId: booking.businessId },
        })
        .catch((error: unknown) => {
          console.error("[charges] provider error", error);
          return {
            status: "failed" as const,
            paymentIntentId: null,
            failureCode: "provider_error",
            failureMessage: "We couldn't reach the payment provider.",
          };
        })
    : {
        status: "failed" as const,
        paymentIntentId: null,
        failureCode: "no_card",
        failureMessage: "No saved card.",
      };

  if (result.status === "succeeded") {
    await deps.db.transaction(async (tx) => {
      for (const id of ids) {
        await tx
          .update(payments)
          .set({
            status: "succeeded",
            succeededAt: now,
            stripePaymentIntentId: result.paymentIntentId,
            releasedAt: target.kind === "visit" && target.releaseNow ? now : null,
          })
          .where(eq(payments.id, id));
      }
      if (target.kind === "periods") {
        await tx
          .update(contractPeriods)
          .set({ status: "charged" })
          .where(
            inArray(
              contractPeriods.id,
              target.periods.map((period) => period.id),
            ),
          );
      }
      if (target.kind === "visit") {
        await tx.update(visits).set({ chargeDueAt: null }).where(eq(visits.id, target.visitId));
      }
    });
    return "succeeded";
  }

  await deps.db.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx
        .update(payments)
        .set({
          status: "failed",
          failureCode: result.failureCode,
          failureMessage: result.failureMessage.slice(0, 500),
          // Keeps the provider's id for support; a placeholder when there was none.
          stripePaymentIntentId: result.paymentIntentId
            ? `${result.paymentIntentId}${index === 0 ? "" : `#${index}`}`
            : `failed_${id}`,
        })
        .where(eq(payments.id, id));
    }
  });
  return "failed";
}

/** Failed attempts at a visit's or month's charge since it last succeeded. */
async function failuresFor(
  db: DbExecutor,
  where: { visitId: string } | { periodId: string },
): Promise<Date[]> {
  const rows = await db
    .select({ createdAt: payments.createdAt })
    .from(payments)
    .where(
      and(
        "visitId" in where
          ? eq(payments.visitId, where.visitId)
          : eq(payments.periodId, where.periodId),
        eq(payments.status, "failed"),
      ),
    )
    .orderBy(asc(payments.createdAt));
  return rows.map((row) => row.createdAt);
}

type RetryDecision = "charge" | "wait" | "give_up";

/** First attempt now; then daily retries; then give up (SPEC §21). */
function retryDecision(failures: Date[], now: Date): RetryDecision {
  const first = failures[0];
  if (!first) return "charge";
  const next = nextChargeRetryAt(first, failures.length);
  if (!next) return "give_up";
  return next.getTime() <= now.getTime() ? "charge" : "wait";
}

/** Tells the customer a charge failed (first failure only) and how to fix it. */
async function notifyFailure(deps: BookingDeps, booking: Booking): Promise<void> {
  await notify(deps.db, [booking.customerId], NOTIFICATION_TYPES.paymentFailed, {
    text: `Your card didn't go through for ${booking.title}. Update it to keep your booking.`,
    path: "/account/card",
  });
  const [customer] = await deps.db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, booking.customerId));
  const email = contactEmail(customer?.email);
  await sendAll(
    deps.email,
    emailsTo(
      email ? [email] : [],
      `Your card didn't go through: ${booking.title}`,
      `We couldn't charge your saved card for ${booking.title}. We'll try again every day for 3 days.\n\nUpdate your card to keep your booking going: ${deps.config.siteUrl}/account/card`,
    ),
  );
}

/** Pauses an ongoing booking after its charge kept failing, and tells both sides. */
export async function pauseBooking(
  deps: BookingDeps,
  booking: Booking,
  reason: string,
): Promise<void> {
  const [paused] = await deps.db
    .update(bookings)
    .set({ pausedAt: deps.now(), pauseReason: reason })
    .where(and(eq(bookings.id, booking.id), isNull(bookings.pausedAt)))
    .returning({ id: bookings.id });
  if (!paused) return;
  await notify(deps.db, [booking.customerId], NOTIFICATION_TYPES.bookingPaused, {
    text: `${booking.title} is paused: your card didn't go through. Update it to resume.`,
    path: "/account/card",
  });
  await notify(
    deps.db,
    await businessTeamUserIds(deps.db, booking.businessId),
    NOTIFICATION_TYPES.bookingPaused,
    {
      text: `Paused for an unpaid charge: ${booking.title}`,
      path: `/business/calendar?b=${booking.businessId}`,
    },
  );
}

/** Runs one decision for a due charge: charge, wait, or give up and pause. */
async function attempt(
  deps: BookingDeps,
  target: ChargeTarget,
  failures: Date[],
  force: boolean,
): Promise<ChargeOutcome | "waiting" | "paused"> {
  const decision = force ? "charge" : retryDecision(failures, deps.now());
  if (decision === "wait") return "waiting";
  if (decision === "give_up") {
    await pauseBooking(deps, target.booking, "payment_failed");
    return "paused";
  }
  const outcome = await chargeTarget(deps, target);
  if (outcome === "failed" && failures.length === 0) await notifyFailure(deps, target.booking);
  return outcome;
}

/** Visits (recurring, or confirmed per-visit snow) whose charge is due and not yet paid. */
async function dueVisits(db: DbExecutor, now: Date, customerId?: string) {
  const rows = await db
    .select({ visit: visits, booking: bookings })
    .from(visits)
    .innerJoin(bookings, eq(bookings.id, visits.bookingId))
    .where(
      and(
        inArray(bookings.kind, ["recurring", "snow_contract"]),
        lte(visits.chargeDueAt, now),
        customerId ? eq(bookings.customerId, customerId) : undefined,
      ),
    )
    .orderBy(asc(visits.chargeDueAt));
  const due = [];
  for (const row of rows) {
    const [live] = await db
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.visitId, row.visit.id), inArray(payments.status, [...LIVE])))
      .limit(1);
    if (!live) due.push(row);
  }
  return due;
}

/** Season months whose charge is due and not yet paid, grouped as one charge each. */
async function duePeriodCharges(db: DbExecutor, now: Date, customerId?: string) {
  const rows = await db
    .select({ period: contractPeriods, booking: bookings, contract: snowContracts })
    .from(contractPeriods)
    .innerJoin(bookings, eq(bookings.id, contractPeriods.bookingId))
    .innerJoin(snowContracts, eq(snowContracts.bookingId, bookings.id))
    .where(
      and(
        eq(contractPeriods.status, "scheduled"),
        lte(contractPeriods.chargeDueAt, now),
        customerId ? eq(bookings.customerId, customerId) : undefined,
      ),
    )
    .orderBy(asc(contractPeriods.bookingId), asc(contractPeriods.sequence));
  // Upfront: every due month of a booking in one charge; monthly: one charge per month.
  const groups = new Map<string, { booking: Booking; periods: ContractPeriod[] }>();
  for (const row of rows) {
    const key =
      row.contract.seasonPayment === "upfront"
        ? row.booking.id
        : `${row.booking.id}:${row.period.id}`;
    const group = groups.get(key) ?? { booking: row.booking, periods: [] };
    group.periods.push(row.period);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Charges everything due (scheduled job, and after a card update with `force`). A recurring
 * visit still unpaid 24 hours before it starts is cancelled and its series paused.
 */
export async function chargeOngoing(
  deps: BookingDeps,
  options: { customerId?: string; force?: boolean } = {},
): Promise<{ charged: number; failed: number; paused: number; cancelled: number }> {
  const now = deps.now();
  const report = { charged: 0, failed: 0, paused: 0, cancelled: 0 };

  // Visits and months already owed are collected even after the booking has ended.
  for (const { visit, booking } of await dueVisits(deps.db, now, options.customerId)) {
    const failures = await failuresFor(deps.db, { visitId: visit.id });
    const target: ChargeTarget = {
      kind: "visit",
      booking,
      visitId: visit.id,
      releaseNow: booking.kind === "snow_contract",
      description: `${booking.title}, visit ${visit.sequence}`,
    };
    if (booking.kind === "recurring") {
      if (visit.status !== "confirmed") continue;
      // Unpaid 24 hours before it starts: cancelled, unless it was never tried (a late
      // acceptance, or a visit moved closer) or the card was just updated; those get one try.
      const pastDeadline = now.getTime() >= recurringPaymentDeadline(visit.startsAt).getTime();
      const tried = failures.length > 0 || booking.pausedAt !== null;
      if (pastDeadline && tried && !options.force) {
        await cancelUnpaidVisit(deps, booking, visit.id);
        report.cancelled += 1;
        continue;
      }
      // A paused series takes no new charges until the card is updated.
      if (booking.pausedAt && !options.force) continue;
      if (pastDeadline) {
        const outcome = await chargeTarget(deps, target);
        if (outcome === "succeeded") {
          report.charged += 1;
        } else {
          if (failures.length === 0) await notifyFailure(deps, booking);
          await cancelUnpaidVisit(deps, booking, visit.id);
          report.failed += 1;
          report.cancelled += 1;
        }
        continue;
      }
    } else if (visit.status !== "completed") {
      continue;
    }
    const outcome = await attempt(deps, target, failures, options.force === true);
    if (outcome === "succeeded") report.charged += 1;
    if (outcome === "failed") report.failed += 1;
    if (outcome === "paused") report.paused += 1;
  }

  for (const group of await duePeriodCharges(deps.db, now, options.customerId)) {
    if (group.booking.pausedAt && !options.force) continue;
    const first = group.periods[0];
    if (!first) continue;
    const failures = await failuresFor(deps.db, { periodId: first.id });
    const outcome = await attempt(
      deps,
      {
        kind: "periods",
        booking: group.booking,
        periods: group.periods,
        description:
          group.periods.length > 1
            ? `${group.booking.title}, season`
            : `${group.booking.title}, ${first.periodStart.slice(0, 7)}`,
      },
      failures,
      options.force === true,
    );
    if (outcome === "succeeded") report.charged += 1;
    if (outcome === "failed") report.failed += 1;
    if (outcome === "paused") report.paused += 1;
  }

  if (report.failed + report.paused + report.cancelled > 0) await pushNotifications(deps);
  return report;
}

/** A recurring visit unpaid 24 hours before it starts: cancel it and pause the series. */
async function cancelUnpaidVisit(
  deps: BookingDeps,
  booking: Booking,
  visitId: string,
): Promise<void> {
  const now = deps.now();
  const [cancelled] = await deps.db
    .update(visits)
    .set({ status: "cancelled_by_customer", cancelledAt: now, chargeDueAt: null })
    .where(and(eq(visits.id, visitId), eq(visits.status, "confirmed")))
    .returning({ startsAt: visits.startsAt });
  if (!cancelled) return;
  await notify(deps.db, [booking.customerId], NOTIFICATION_TYPES.visitCancelled, {
    text: `A visit of ${booking.title} was cancelled: the payment didn't go through.`,
    path: `/bookings/${booking.id}`,
  });
  await pauseBooking(deps, booking, "payment_failed");
}

/**
 * After the customer saves a new card: retry what they owe now, and resume their paused
 * ongoing bookings once nothing is owed.
 */
export async function afterCardSaved(deps: BookingDeps, customerId: string): Promise<void> {
  await chargeOngoing(deps, { customerId, force: true });
  const paused = await deps.db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.customerId, customerId),
        inArray(bookings.kind, ["recurring", "snow_contract"]),
        isNotNull(bookings.pausedAt),
      ),
    );
  const now = deps.now();
  for (const booking of paused) {
    const owedVisits = (await dueVisits(deps.db, now, customerId)).filter(
      (row) => row.booking.id === booking.id,
    );
    const owedPeriods = (await duePeriodCharges(deps.db, now, customerId)).filter(
      (group) => group.booking.id === booking.id,
    );
    if (owedVisits.length === 0 && owedPeriods.length === 0) {
      await deps.db
        .update(bookings)
        .set({ pausedAt: null, pauseReason: null })
        .where(eq(bookings.id, booking.id));
    }
  }
  await pushNotifications(deps);
}

/** Releases season months to the business once each month is over (scheduled job). */
export async function releaseSeasonMonths(deps: BookingDeps): Promise<number> {
  const now = deps.now();
  const due = await deps.db
    .select({ paymentId: payments.id, releaseAt: contractPeriods.releaseAt })
    .from(payments)
    .innerJoin(contractPeriods, eq(contractPeriods.id, payments.periodId))
    .where(
      and(
        inArray(payments.status, ["succeeded", "partially_refunded"]),
        isNull(payments.releasedAt),
        lte(contractPeriods.releaseAt, now),
      ),
    );
  for (const row of due) {
    await deps.db
      .update(payments)
      .set({ releasedAt: row.releaseAt })
      .where(eq(payments.id, row.paymentId));
  }
  return due.length;
}
