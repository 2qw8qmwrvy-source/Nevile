import { contactEmail } from "@nevile/auth";
import {
  type BookingState,
  BUSINESS_FEE_BPS,
  CANCELLATION_POLICIES,
  eventsFrom,
  formatCad,
  percentOf,
  transition,
} from "@nevile/core";
import {
  type Address,
  and,
  asc,
  type BookingCheckout,
  bookingCheckouts,
  conversations,
  type DbExecutor,
  eq,
  inArray,
  refunds,
  sql,
  type User,
} from "@nevile/db";
import type { OngoingDetails } from "../ongoing/views.ts";
import { whenLabel } from "./emails.ts";
import { type BookingParts, customerCancellationQuote, snapshotOf } from "./flows.ts";

export const CUSTOMER_STATUS_LABELS: Record<BookingState, string> = {
  requested: "Waiting for the pro",
  quote_requested: "Quote requested",
  quoted: "Quote received",
  confirmed: "Booked",
  completed_pending_confirmation: "Done: please confirm",
  disputed: "Problem reported",
  fix_scheduled: "Fix on the way",
  completed: "Completed",
  cancelled_by_customer: "Cancelled by you",
  cancelled_by_business: "Cancelled by the pro",
  declined: "Declined",
  expired: "Request expired",
  refunded: "Refunded",
};

export const BUSINESS_STATUS_LABELS: Record<BookingState, string> = {
  ...CUSTOMER_STATUS_LABELS,
  requested: "Request: accept or decline",
  completed_pending_confirmation: "Done: waiting for the customer",
  cancelled_by_customer: "Cancelled by the customer",
  cancelled_by_business: "Cancelled by you",
};

/** Lifecycle events allowed right now (core state machine, guards included). */
export function allowedEvents(parts: BookingParts, now: Date) {
  const snapshot = snapshotOf(parts);
  return new Set(
    eventsFrom(snapshot.state).filter((type) => transition(snapshot, { type, at: now }).ok),
  );
}

export function addressLines(address: Pick<Address, "line1" | "line2" | "city" | "postalCode">) {
  return [address.line1, address.line2, `${address.city}, NS ${address.postalCode}`].filter(
    (line): line is string => Boolean(line),
  );
}

function windowOf(parts: BookingParts) {
  const startsAt =
    parts.visit?.startsAt ?? parts.booking.requestedStartsAt ?? parts.booking.createdAt;
  const endsAt = parts.visit?.endsAt ?? parts.booking.requestedEndsAt ?? startsAt;
  return { startsAt, endsAt, label: whenLabel(startsAt, endsAt, parts.booking.timezone) };
}

async function refundedCents(db: DbExecutor, paymentId: string | undefined): Promise<number> {
  if (!paymentId) return 0;
  const [row] = await db
    .select({ cents: sql<number>`coalesce(sum(${refunds.amountCents}), 0)`.mapWith(Number) })
    .from(refunds)
    .where(and(eq(refunds.paymentId, paymentId), eq(refunds.status, "succeeded")));
  return row?.cents ?? 0;
}

/**
 * A booking as its customer sees it, with what they can do now. Recurring series pass
 * their `ongoing` details: the series has its own status, and visits their own actions.
 */
export async function customerBookingView(
  db: DbExecutor,
  parts: BookingParts,
  address: Address,
  now: Date,
  ongoing: OngoingDetails | null = null,
) {
  const { booking, business, payment, visit } = parts;
  const status = (ongoing ? booking.status : (visit?.status ?? booking.status)) as BookingState;
  const allowed = ongoing ? new Set<string>() : allowedEvents(parts, now);
  const quote = allowed.has("cancel_by_customer") ? customerCancellationQuote(parts, now) : null;
  const policy = CANCELLATION_POLICIES[booking.cancellationPolicy];
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.bookingId, booking.id));
  return {
    id: booking.id,
    kind: booking.kind,
    status,
    statusLabel:
      ongoing?.paused && status === "confirmed" ? "Paused" : CUSTOMER_STATUS_LABELS[status],
    business: { name: business.name, slug: business.slug },
    service: { title: booking.title },
    /** Booked from a quote (SPEC §20). */
    fromQuote: booking.quoteId !== null,
    /** The job's window; a series shows its next visit (or its first). */
    window: ongoing?.nextVisit?.window ?? windowOf(parts),
    address: addressLines(address),
    notes: booking.customerNotes,
    amounts: {
      priceCents: booking.priceCents,
      serviceFeeCents: booking.serviceFeeCents,
      taxCents: booking.priceTaxCents + booking.feeTaxCents,
      totalCents: booking.totalCents,
      held: !ongoing && payment?.status === "authorized",
      refundedCents: ongoing ? 0 : await refundedCents(db, payment?.id),
    },
    cancellationPolicy: { label: policy.label, description: policy.description },
    approvalExpiresAt: booking.status === "requested" ? booking.approvalExpiresAt : null,
    /** Why the pro cancelled (customers are told; SPEC §5). */
    cancellationReason:
      status === "cancelled_by_business" || (ongoing && booking.cancelledAt)
        ? booking.cancellationReason
        : null,
    autoConfirmAt: ongoing ? null : (visit?.autoConfirmAt ?? null),
    actions: {
      /** One-off: cancel the job. Series: cancel the request, or end the series. */
      cancel: ongoing
        ? booking.status === "requested" || booking.status === "confirmed"
        : allowed.has("cancel_by_customer"),
      confirmDone: allowed.has("confirm_completion"),
      reportProblem: allowed.has("report_problem"),
    },
    /** What cancelling now refunds (confirmed jobs); requests just release the hold. */
    cancelQuote: quote
      ? {
          refundCents: quote.totalRefundCents,
          free: quote.isFreeCancellation,
          text: quote.isFreeCancellation
            ? `Free cancellation: you get ${formatCad(quote.totalRefundCents)} back (the service fee isn't refunded).`
            : quote.totalRefundCents > 0
              ? `Late cancellation: you get ${formatCad(quote.totalRefundCents)} back under the ${policy.label} policy.`
              : `Late cancellation: no refund is due under the ${policy.label} policy.`,
        }
      : null,
    /** Recurring series (SPEC §21): schedule, visits and what can be done to each. */
    ongoing,
    /** Something here waits for the customer (a visit to confirm). */
    needsAttention:
      allowed.has("confirm_completion") ||
      allowed.has("report_problem") ||
      (ongoing?.needsAttention ?? false),
    createdAt: booking.createdAt,
    /** Chat with the business about this job (SPEC §20). */
    conversationId: conversation?.id ?? null,
  };
}
export type CustomerBookingView = Awaited<ReturnType<typeof customerBookingView>>;

/** First name only, for the business calendar ("Cora"). */
export function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "Customer";
}

/** A booking as the business sees it on its calendar. */
export function businessBookingView(
  parts: BookingParts,
  extra: {
    address: Address;
    customer: Pick<User, "name" | "email" | "phoneNumber">;
    assignee: { id: string; name: string } | null;
    workMinutes: number;
    /** Only for owners and managers (crew don't see chat). */
    conversationId?: string | null;
    /** Recurring visits: "Every week · visit 3 of 12" (SPEC §21). */
    series?: string | null;
  },
  now: Date,
) {
  const { booking, payment, visit } = parts;
  const status = (visit?.status ?? booking.status) as BookingState;
  const allowed = allowedEvents(parts, now);
  // Contact details only once the booking is paid (SPEC §7).
  const paid = payment?.status === "succeeded" || payment?.status === "partially_refunded";
  const recurring = booking.kind === "recurring";
  return {
    id: booking.id,
    /** Unique per calendar entry: a series has one entry per visit. */
    key: visit?.id ?? booking.id,
    visitId: visit?.id ?? null,
    kind: booking.kind,
    series: extra.series ?? null,
    status,
    statusLabel: BUSINESS_STATUS_LABELS[status],
    service: { id: parts.service.id, title: booking.title },
    window: windowOf(parts),
    workMinutes: extra.workMinutes,
    customer: {
      firstName: firstName(extra.customer.name),
      email: paid ? contactEmail(extra.customer.email) : null,
      phone: paid ? extra.customer.phoneNumber : null,
    },
    address: addressLines(extra.address),
    notes: booking.customerNotes,
    assignee: extra.assignee,
    payout: {
      /** Price + HST on the price − 3% (before any refunds). */
      cents:
        (payment?.priceCents ?? booking.priceCents) +
        (payment?.priceTaxCents ?? booking.priceTaxCents) -
        (payment?.businessFeeCents ?? percentOf(booking.priceCents, BUSINESS_FEE_BPS)),
    },
    approvalExpiresAt: booking.status === "requested" ? booking.approvalExpiresAt : null,
    conversationId: extra.conversationId ?? null,
    actions: {
      accept: allowed.has("approve"),
      decline: allowed.has("decline"),
      assign:
        visit !== null &&
        !["cancelled_by_customer", "cancelled_by_business", "completed", "refunded"].includes(
          status,
        ),
      markDone: allowed.has("mark_complete"),
      /** One-off: cancel the job. Series: cancel this visit (full refund). */
      cancel: allowed.has("cancel_by_business") && (!recurring || booking.status === "confirmed"),
      /** Series only: move this visit to another window or day. */
      move:
        recurring &&
        booking.status === "confirmed" &&
        visit?.status === "confirmed" &&
        visit.startsAt.getTime() > now.getTime(),
      scheduleFix: allowed.has("schedule_fix"),
      markFixed: allowed.has("mark_fixed"),
    },
  };
}
export type BusinessBookingView = ReturnType<typeof businessBookingView>;

/** Work minutes for requests (their checkout) in one query. */
export async function checkoutWorkMinutes(
  db: DbExecutor,
  bookingIds: string[],
): Promise<Map<string, number>> {
  if (bookingIds.length === 0) return new Map();
  const rows: Array<Pick<BookingCheckout, "bookingId" | "workMinutes">> = await db
    .select({ bookingId: bookingCheckouts.bookingId, workMinutes: bookingCheckouts.workMinutes })
    .from(bookingCheckouts)
    .where(inArray(bookingCheckouts.bookingId, bookingIds))
    .orderBy(asc(bookingCheckouts.createdAt));
  return new Map(rows.flatMap((row) => (row.bookingId ? [[row.bookingId, row.workMinutes]] : [])));
}
