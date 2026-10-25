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
  and,
  asc,
  type Booking,
  count,
  type DbExecutor,
  type Dispute,
  disputes,
  eq,
  inArray,
  type Payment,
  payments,
  refunds,
  sql,
  type Visit,
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
  const labels = audience === "customer" ? CUSTOMER_STATUS_LABELS : BUSINESS_STATUS_LABELS;
  const running = booking.status === "confirmed";

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
        label: whenLabel(visit.startsAt, visit.endsAt, booking.timezone),
      },
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

/** The series part of an ongoing booking's view; null for one-off jobs. */
export async function ongoingDetails(
  db: DbExecutor,
  parts: BookingParts,
  audience: Audience,
  now: Date,
  memberNames?: ReadonlyMap<string, string>,
) {
  const { booking } = parts;
  if (!isOngoing(booking) || booking.kind !== "recurring") return null;
  const { series } = await loadSeries(db, booking.id);
  const list = await visitViews(db, parts, audience, now, memberNames);
  const upcoming = list.filter(
    (visit) => visit.status === "confirmed" && visit.window.endsAt.getTime() >= now.getTime(),
  );
  const done = list.filter((visit) =>
    ["completed_pending_confirmation", "disputed", "fix_scheduled", "completed"].includes(
      visit.status,
    ),
  );
  const fee = percentOf(booking.priceCents, BUSINESS_FEE_BPS);
  return {
    kind: "recurring" as const,
    frequency: series.frequency,
    frequencyLabel: FREQUENCY_LABELS[series.frequency],
    schedule: scheduleLabel(booking, series),
    firstDate: series.firstDate,
    endDate: series.endDate,
    perVisit: {
      priceCents: booking.priceCents,
      serviceFeeCents: booking.serviceFeeCents,
      taxCents: booking.priceTaxCents + booking.feeTaxCents,
      totalCents: booking.totalCents,
      /** What the business gets per visit: price + HST on it − 3%. */
      payoutCents: booking.priceCents + booking.priceTaxCents - fee,
    },
    paused: booking.pausedAt
      ? {
          since: booking.pausedAt,
          text:
            audience === "customer"
              ? "Paused: your card didn't go through. Update it to resume."
              : "Paused: the customer's card didn't go through. No visits are charged until they update it.",
        }
      : null,
    /** When the series was ended early (by either side). */
    endedAt: booking.cancelledAt,
    counts: { visits: list.length, upcoming: upcoming.length, done: done.length },
    nextVisit: upcoming[0] ?? null,
    visits: list,
    needsAttention: list.some((visit) =>
      "confirmDone" in visit.actions
        ? visit.actions.confirmDone || visit.actions.reportProblem
        : visit.actions.scheduleFix || visit.actions.markFixed,
    ),
  };
}
export type OngoingDetails = NonNullable<Awaited<ReturnType<typeof ongoingDetails>>>;

/** A calendar badge for a recurring job: "Every week · visit 3 of 12" (null otherwise). */
export async function seriesBadge(
  db: DbExecutor,
  booking: Booking,
  visit: Visit | null,
): Promise<string | null> {
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
