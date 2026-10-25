/**
 * How recurring series (and their visits) read to the customer and the business
 * (SPEC §21). Visits are loaded in bulk so a 6-month series is a handful of queries.
 */
import {
  type BookingState,
  BUSINESS_FEE_BPS,
  CANCELLATION_POLICIES,
  FREQUENCY_LABELS,
  formatCad,
  occurrenceDates,
  parseIsoDate,
  percentOf,
} from "@nevile/core";
import {
  agreements,
  and,
  asc,
  type Booking,
  contractPeriods,
  count,
  type DbExecutor,
  type Dispute,
  desc,
  disputes,
  eq,
  inArray,
  type Payment,
  payments,
  refunds,
  snowContracts,
  sql,
  type Visit,
  visitPhotos,
  visits,
} from "@nevile/db";
import { whenLabel } from "../bookings/emails.ts";
import { type BookingParts, isOngoing } from "../bookings/flows.ts";
import {
  allowedEvents,
  BUSINESS_STATUS_LABELS,
  CUSTOMER_STATUS_LABELS,
} from "../bookings/views.ts";
import { loadSeries, scheduleLabel, skipTerms } from "./recurring.ts";
import { periodLabel, seasonLabel } from "./snow.ts";

export type Audience = "customer" | "business";

/** Where a visit's money stands. */
export type VisitChargeState =
  | "scheduled"
  | "charging"
  | "charged"
  | "partly_refunded"
  | "refunded"
  | "failed"
  | "none";

const LIVE_PAYMENT_STATES: readonly Payment["status"][] = [
  "pending",
  "succeeded",
  "partially_refunded",
  "refunded",
];

function chargeState(
  visit: BookingParts["visit"],
  payment: Payment | null,
  failed: boolean,
): VisitChargeState {
  if (payment) {
    if (payment.status === "pending") return "charging";
    if (payment.status === "partially_refunded") return "partly_refunded";
    if (payment.status === "refunded") return "refunded";
    return "charged";
  }
  if (!visit?.chargeDueAt) return "none";
  return failed ? "failed" : "scheduled";
}

/** Every visit of an ongoing booking with its payment, dispute and allowed actions. */
export async function visitViews(
  db: DbExecutor,
  parts: Pick<BookingParts, "booking" | "service" | "business">,
  audience: Audience,
  now: Date,
  memberNames: ReadonlyMap<string, string> = new Map(),
) {
  const { booking } = parts;
  const rows = await db
    .select()
    .from(visits)
    .where(eq(visits.bookingId, booking.id))
    .orderBy(asc(visits.startsAt), asc(visits.sequence));
  const ids = rows.map((visit) => visit.id);
  const paymentRows =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(payments)
          .where(and(eq(payments.bookingId, booking.id), inArray(payments.visitId, ids)));
  const disputeRows: Dispute[] =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(disputes)
          .where(
            and(
              inArray(disputes.visitId, ids),
              inArray(disputes.status, ["open", "fix_scheduled", "escalated"]),
            ),
          );
  const live = paymentRows.filter((payment) => LIVE_PAYMENT_STATES.includes(payment.status));
  const refunded = new Map(
    live.length === 0
      ? []
      : (
          await db
            .select({
              paymentId: refunds.paymentId,
              cents: sql<number>`coalesce(sum(${refunds.amountCents}), 0)`.mapWith(Number),
            })
            .from(refunds)
            .where(
              and(
                inArray(
                  refunds.paymentId,
                  live.map((payment) => payment.id),
                ),
                eq(refunds.status, "succeeded"),
              ),
            )
            .groupBy(refunds.paymentId)
        ).map((row) => [row.paymentId, row.cents]),
  );
  const photoRows =
    ids.length === 0
      ? []
      : await db
          .select({ id: visitPhotos.id, visitId: visitPhotos.visitId })
          .from(visitPhotos)
          .where(inArray(visitPhotos.visitId, ids))
          .orderBy(asc(visitPhotos.createdAt));
  const labels = audience === "customer" ? CUSTOMER_STATUS_LABELS : BUSINESS_STATUS_LABELS;
  const running = booking.status === "confirmed";
  const snow = booking.kind === "snow_contract";

  return rows.map((visit) => {
    const payment = live.find((row) => row.visitId === visit.id) ?? null;
    const failed = paymentRows.some((row) => row.visitId === visit.id && row.status === "failed");
    const visitParts: BookingParts = {
      ...parts,
      visit,
      payment,
      dispute: disputeRows.find((row) => row.visitId === visit.id) ?? null,
    };
    const allowed = allowedEvents(visitParts, now);
    const status = visit.status as BookingState;
    const upcoming = visit.status === "confirmed" && visit.startsAt.getTime() > now.getTime();
    const canSkip =
      audience === "customer" &&
      running &&
      booking.kind === "recurring" &&
      allowed.has("cancel_by_customer");
    const skip = canSkip ? skipTerms(visitParts, now) : null;
    const policy = CANCELLATION_POLICIES[booking.cancellationPolicy];
    return {
      id: visit.id,
      sequence: visit.sequence,
      status,
      statusLabel: labels[status],
      window: {
        startsAt: visit.startsAt,
        endsAt: visit.endsAt,
        // Snow visits are logged when the address is cleared, not booked into a window.
        label: snow
          ? clearedLabel(visit.startsAt, booking.timezone)
          : whenLabel(visit.startsAt, visit.endsAt, booking.timezone),
      },
      /** Photos the pro added when logging it (SPEC §21). */
      photos: photoRows
        .filter((photo) => photo.visitId === visit.id)
        .map((photo) => ({ id: photo.id, url: `/api/visit-photos/${photo.id}` })),
      charge: {
        state: chargeState(visit, payment, failed),
        dueAt: payment ? null : visit.chargeDueAt,
        amountCents: payment?.amountCents ?? booking.totalCents,
        refundedCents: payment ? (refunded.get(payment.id) ?? 0) : 0,
      },
      autoConfirmAt: visit.autoConfirmAt,
      assignee:
        audience === "business" && visit.assignedMemberId
          ? {
              id: visit.assignedMemberId,
              name: memberNames.get(visit.assignedMemberId) ?? "Crew member",
            }
          : null,
      actions:
        audience === "customer"
          ? {
              skip: canSkip,
              confirmDone: allowed.has("confirm_completion"),
              reportProblem: allowed.has("report_problem"),
            }
          : {
              move: running && booking.kind === "recurring" && upcoming,
              cancel: running && booking.kind === "recurring" && allowed.has("cancel_by_business"),
              markDone: allowed.has("mark_complete"),
              scheduleFix: allowed.has("schedule_fix"),
              markFixed: allowed.has("mark_fixed"),
              assign: [
                "confirmed",
                "completed_pending_confirmation",
                "disputed",
                "fix_scheduled",
              ].includes(visit.status),
            },
      /** What skipping it now means (customers, when they can skip). */
      skip: skip
        ? {
            refundCents: skip.refundCents,
            chargeCents: skip.chargeCents,
            text:
              skip.refundCents > 0
                ? `Skip it and get ${formatCad(skip.refundCents)} back (the service fee isn't refunded).`
                : skip.chargeCents > 0
                  ? `It's inside the cancellation window: skipping costs ${formatCad(skip.chargeCents)} under the ${policy.label} policy.`
                  : payment
                    ? `It's inside the cancellation window: no refund under the ${policy.label} policy.`
                    : "Free to skip: it hasn't been charged.",
          }
        : null,
    };
  });
}
export type VisitView = Awaited<ReturnType<typeof visitViews>>[number];

const CLEARED_DAY = (timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** "Cleared Tuesday, January 12 at 7:05 a.m." */
export function clearedLabel(at: Date, timeZone: string): string {
  const parts = CLEARED_DAY(timeZone).formatToParts(at);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `Cleared ${value("weekday")}, ${value("month")} ${value("day")} at ${value("hour")}:${value(
    "minute",
  )} ${value("dayPeriod")}`.trim();
}

function pausedNotice(booking: Booking, audience: Audience) {
  if (!booking.pausedAt) return null;
  return {
    since: booking.pausedAt,
    text:
      audience === "customer"
        ? "Paused: your card didn't go through. Update it to resume."
        : booking.kind === "snow_contract"
          ? "Paused: the customer's card didn't go through. Don't clear it until they update it."
          : "Paused: the customer's card didn't go through. No visits are charged until they update it.",
  };
}

/** Where a season month's money stands. */
export type MonthChargeState =
  | "scheduled"
  | "charging"
  | "charged"
  | "partly_refunded"
  | "refunded"
  | "failed"
  | "cancelled";

async function seasonMonths(db: DbExecutor, bookingId: string) {
  const periods = await db
    .select()
    .from(contractPeriods)
    .where(eq(contractPeriods.bookingId, bookingId))
    .orderBy(asc(contractPeriods.sequence));
  if (periods.length === 0) return [];
  const ids = periods.map((period) => period.id);
  const rows = await db.select().from(payments).where(inArray(payments.periodId, ids));
  const live = rows.filter((payment) => LIVE_PAYMENT_STATES.includes(payment.status));
  const refunded =
    live.length === 0
      ? []
      : await db
          .select({
            paymentId: refunds.paymentId,
            cents: sql<number>`coalesce(sum(${refunds.amountCents}), 0)`.mapWith(Number),
          })
          .from(refunds)
          .where(
            and(
              inArray(
                refunds.paymentId,
                live.map((payment) => payment.id),
              ),
              eq(refunds.status, "succeeded"),
            ),
          )
          .groupBy(refunds.paymentId);
  return periods.map((period) => {
    const payment = live.find((row) => row.periodId === period.id);
    const failed = rows.some((row) => row.periodId === period.id && row.status === "failed");
    const state: MonthChargeState = payment
      ? payment.status === "pending"
        ? "charging"
        : payment.status === "partially_refunded"
          ? "partly_refunded"
          : payment.status === "refunded"
            ? "refunded"
            : "charged"
      : period.status === "cancelled"
        ? "cancelled"
        : failed
          ? "failed"
          : "scheduled";
    return {
      sequence: period.sequence,
      label: periodLabel(period.periodStart, period.periodEnd, monthDays(period)),
      start: period.periodStart,
      end: period.periodEnd,
      totalCents: period.totalCents,
      /** The business's share: price + HST on it − 3%. */
      payoutCents:
        period.priceCents + period.priceTaxCents - percentOf(period.priceCents, BUSINESS_FEE_BPS),
      state,
      chargeDueAt: state === "scheduled" || state === "failed" ? period.chargeDueAt : null,
      refundedCents: payment
        ? (refunded.find((row) => row.paymentId === payment.id)?.cents ?? 0)
        : 0,
    };
  });
}

function monthDays(period: { periodStart: string; periodEnd: string }): number {
  const start = parseIsoDate(period.periodStart);
  const end = parseIsoDate(period.periodEnd);
  if (!start || !end) return 1;
  return (
    Math.round(
      (Date.UTC(end.year, end.month - 1, end.day) -
        Date.UTC(start.year, start.month - 1, start.day)) /
        86_400_000,
    ) + 1
  );
}

/**
 * The ongoing part of a booking's view (SPEC §21): a recurring series' schedule and
 * visits, or a snow contract's terms, months and logged visits. Null for one-off jobs.
 */
export async function ongoingDetails(
  db: DbExecutor,
  parts: BookingParts,
  audience: Audience,
  now: Date,
  memberNames?: ReadonlyMap<string, string>,
) {
  const { booking } = parts;
  if (!isOngoing(booking)) return null;
  const list = await visitViews(db, parts, audience, now, memberNames);
  const upcoming = list.filter(
    (visit) => visit.status === "confirmed" && visit.window.endsAt.getTime() >= now.getTime(),
  );
  const done = list.filter((visit) =>
    ["completed_pending_confirmation", "disputed", "fix_scheduled", "completed"].includes(
      visit.status,
    ),
  );
  const perVisit = {
    priceCents: booking.priceCents,
    serviceFeeCents: booking.serviceFeeCents,
    taxCents: booking.priceTaxCents + booking.feeTaxCents,
    totalCents: booking.totalCents,
    /** What the business gets per visit: price + HST on it − 3%. */
    payoutCents:
      booking.priceCents + booking.priceTaxCents - percentOf(booking.priceCents, BUSINESS_FEE_BPS),
  };
  const common = {
    paused: pausedNotice(booking, audience),
    /** When it was ended early (by either side). */
    endedAt: booking.cancelledAt,
    counts: { visits: list.length, upcoming: upcoming.length, done: done.length },
    needsAttention: list.some((visit) =>
      "confirmDone" in visit.actions
        ? visit.actions.confirmDone || visit.actions.reportProblem
        : visit.actions.scheduleFix || visit.actions.markFixed,
    ),
  };

  if (booking.kind === "snow_contract") {
    const [contract] = await db
      .select()
      .from(snowContracts)
      .where(eq(snowContracts.bookingId, booking.id));
    if (!contract) return null;
    const [agreement] = await db
      .select()
      .from(agreements)
      .where(eq(agreements.bookingId, booking.id))
      .orderBy(desc(agreements.version))
      .limit(1);
    const months = contract.seasonPriceCents === null ? [] : await seasonMonths(db, booking.id);
    return {
      kind: "snow_contract" as const,
      ...common,
      terms: {
        triggerCm: contract.triggerCm,
        seasonStart: contract.seasonStart,
        seasonEnd: contract.seasonEnd,
        season: seasonLabel(contract.seasonStart, contract.seasonEnd),
      },
      pricing: contract.seasonPriceCents === null ? ("per_visit" as const) : ("season" as const),
      perVisit: contract.seasonPriceCents === null ? perVisit : null,
      season:
        contract.seasonPriceCents === null
          ? null
          : {
              payment: contract.seasonPayment,
              paymentLabel: contract.seasonPayment === "monthly" ? "Paid monthly" : "Paid upfront",
              totalCents: booking.totalCents,
              months,
            },
      agreement: agreement
        ? {
            path: `/api/agreements/${booking.id}`,
            acceptedByCustomerAt: agreement.acceptedByCustomerAt,
            acceptedByBusinessAt: agreement.acceptedByBusinessAt,
          }
        : null,
      // Newest first: the route log reads back from the last storm.
      nextVisit: null,
      visits: [...list].reverse(),
    };
  }

  const { series } = await loadSeries(db, booking.id);
  return {
    kind: "recurring" as const,
    ...common,
    frequency: series.frequency,
    frequencyLabel: FREQUENCY_LABELS[series.frequency],
    schedule: scheduleLabel(booking, series),
    firstDate: series.firstDate,
    endDate: series.endDate,
    perVisit,
    nextVisit: upcoming[0] ?? null,
    visits: list,
  };
}
export type OngoingDetails = NonNullable<Awaited<ReturnType<typeof ongoingDetails>>>;

/** A calendar badge: "Every week · visit 3 of 12", "Snow contract · visit 2" (null otherwise). */
export async function seriesBadge(
  db: DbExecutor,
  booking: Booking,
  visit: Visit | null,
): Promise<string | null> {
  if (booking.kind === "snow_contract") {
    return visit ? `Snow contract · visit ${visit.sequence}` : "Snow contract sign-up";
  }
  if (booking.kind !== "recurring") return null;
  const { series, overrides } = await loadSeries(db, booking.id);
  const label = FREQUENCY_LABELS[series.frequency];
  if (!visit) {
    const first = parseIsoDate(series.firstDate);
    const end = parseIsoDate(series.endDate);
    if (!first || !end) return label;
    const skipped = overrides.filter((row) => row.windowStartMinute === null).length;
    const planned = occurrenceDates(series.frequency, first, end, 40).length - skipped;
    return `${label} · ${planned} ${planned === 1 ? "visit" : "visits"}`;
  }
  const [row] = await db
    .select({ total: count() })
    .from(visits)
    .where(eq(visits.bookingId, booking.id));
  return `${label} · visit ${visit.sequence} of ${row?.total ?? visit.sequence}`;
}
