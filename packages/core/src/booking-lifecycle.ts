/**
 * Booking / visit state machine — SPEC §3 (quotes), §4 (approval), §5 (cancellations)
 * and §6 (completion & disputes).
 *
 *   quote_requested ──send_quote──▶ quoted ──accept_quote──▶ confirmed
 *   requested ──approve──▶ confirmed            (instant book starts at confirmed)
 *   confirmed ──mark_complete──▶ completed_pending_confirmation
 *   completed_pending_confirmation ──confirm_completion / auto_confirm──▶ completed
 *   completed_pending_confirmation ──report_problem──▶ disputed ──schedule_fix──▶ fix_scheduled
 *   fix_scheduled ──mark_fixed──▶ completed_pending_confirmation
 *   disputed | fix_scheduled ──admin_release_payout──▶ completed | ──admin_refund──▶ refunded
 *
 * Timers (elapsed time, not calendar days):
 * - approval requests expire 24h after the request (or at the job start, if sooner);
 * - quotes expire 7 days after they are sent (re-sending a quote restarts the clock);
 * - completion auto-confirms 48h after the job is marked complete;
 * - the business has 3 days from the first problem report to fix it; after that the
 *   booking waits for an admin decision (see `needsAdminDecision`).
 *
 * `declined` is not a cancellation: a business turning down a request or withdrawing a
 * quote does not count against its reliability stats, unlike `cancelled_by_business`.
 * `refunded` covers both admin outcomes that return money (full or partial refund); the
 * refunded amount lives on the payment record.
 */
import type { PricingType } from "./schemas.ts";
import { assertValidDate, MS_PER_DAY, MS_PER_HOUR } from "./time.ts";

export const BOOKING_STATES = [
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
export type BookingState = (typeof BOOKING_STATES)[number];

export const TERMINAL_BOOKING_STATES = [
  "completed",
  "cancelled_by_customer",
  "cancelled_by_business",
  "declined",
  "expired",
  "refunded",
] as const satisfies readonly BookingState[];

export const APPROVAL_EXPIRY_HOURS = 24;
export const QUOTE_EXPIRY_DAYS = 7;
export const COMPLETION_CONFIRMATION_HOURS = 48;
export const FIX_WINDOW_DAYS = 3;

export const BOOKING_EVENT_TYPES = [
  "approve",
  "decline",
  "send_quote",
  "accept_quote",
  "expire",
  "cancel_by_customer",
  "cancel_by_business",
  "mark_complete",
  "confirm_completion",
  "auto_confirm",
  "report_problem",
  "schedule_fix",
  "mark_fixed",
  "admin_release_payout",
  "admin_refund",
] as const;
export type BookingEventType = (typeof BOOKING_EVENT_TYPES)[number];

export type BookingActor = "customer" | "business" | "system" | "admin";

export type BookingEvent = {
  type: BookingEventType;
  /** When the event happens; time-based guards are evaluated at this instant. */
  at: Date;
};

/** The persisted facts the state machine needs about a booking. */
export type BookingSnapshot = {
  state: BookingState;
  /** When the booking entered `state`. */
  enteredAt: Date;
  /** Scheduled start of the job/visit, when known. */
  startsAt?: Date | null;
  /** When the first problem was reported; the fix window is measured from here. */
  disputeOpenedAt?: Date | null;
};

type Rule = {
  actor: BookingActor;
  from: readonly BookingState[];
  to: BookingState;
};

const RULES: Readonly<Record<BookingEventType, Rule>> = {
  approve: { actor: "business", from: ["requested"], to: "confirmed" },
  decline: {
    actor: "business",
    from: ["requested", "quote_requested", "quoted"],
    to: "declined",
  },
  send_quote: { actor: "business", from: ["quote_requested", "quoted"], to: "quoted" },
  accept_quote: { actor: "customer", from: ["quoted"], to: "confirmed" },
  expire: { actor: "system", from: ["requested", "quoted"], to: "expired" },
  cancel_by_customer: {
    actor: "customer",
    from: ["requested", "quote_requested", "quoted", "confirmed"],
    to: "cancelled_by_customer",
  },
  cancel_by_business: { actor: "business", from: ["confirmed"], to: "cancelled_by_business" },
  mark_complete: {
    actor: "business",
    from: ["confirmed"],
    to: "completed_pending_confirmation",
  },
  confirm_completion: {
    actor: "customer",
    from: ["completed_pending_confirmation", "disputed", "fix_scheduled"],
    to: "completed",
  },
  auto_confirm: { actor: "system", from: ["completed_pending_confirmation"], to: "completed" },
  report_problem: {
    actor: "customer",
    from: ["completed_pending_confirmation"],
    to: "disputed",
  },
  schedule_fix: { actor: "business", from: ["disputed"], to: "fix_scheduled" },
  mark_fixed: {
    actor: "business",
    from: ["fix_scheduled"],
    to: "completed_pending_confirmation",
  },
  admin_release_payout: {
    actor: "admin",
    from: ["disputed", "fix_scheduled"],
    to: "completed",
  },
  admin_refund: {
    actor: "admin",
    from: ["confirmed", "completed_pending_confirmation", "disputed", "fix_scheduled"],
    to: "refunded",
  },
};

/** Who is allowed to trigger each event (enforced by the API layer). */
export const BOOKING_EVENT_ACTORS: Readonly<Record<BookingEventType, BookingActor>> =
  Object.fromEntries(BOOKING_EVENT_TYPES.map((type) => [type, RULES[type].actor])) as Record<
    BookingEventType,
    BookingActor
  >;

export function isBookingState(value: unknown): value is BookingState {
  return typeof value === "string" && (BOOKING_STATES as readonly string[]).includes(value);
}

export function isTerminalBookingState(state: BookingState): boolean {
  return (TERMINAL_BOOKING_STATES as readonly BookingState[]).includes(state);
}

/** Events that are structurally allowed from `state` (guards not evaluated). */
export function eventsFrom(state: BookingState): BookingEventType[] {
  return BOOKING_EVENT_TYPES.filter((type) => RULES[type].from.includes(state));
}

/** Where a new booking starts. */
export function initialBookingState(input: {
  pricingType: PricingType;
  /** Business confirms fixed-price bookings instantly instead of approving them. */
  instantBook: boolean;
}): BookingState {
  if (input.pricingType === "quote") return "quote_requested";
  return input.instantBook ? "confirmed" : "requested";
}

export type DeadlineOptions = {
  /** Fix-window anchor for `disputed` / `fix_scheduled`; defaults to `enteredAt`. */
  disputeOpenedAt?: Date | null;
  /** Job start; an approval request cannot outlive it. */
  startsAt?: Date | null;
};

/**
 * When the timer attached to `state` runs out, or null if the state has no timer.
 * - requested: approval expires (24h, capped at the job start);
 * - quoted: quote expires (7 days);
 * - completed_pending_confirmation: auto-confirm (48h);
 * - disputed / fix_scheduled: fix window ends, admin decides (3 days from the dispute).
 */
export function deadlineFor(
  state: BookingState,
  enteredAt: Date,
  options: DeadlineOptions = {},
): Date | null {
  assertValidDate(enteredAt, "enteredAt");
  const from = enteredAt.getTime();
  switch (state) {
    case "requested": {
      const expiry = from + APPROVAL_EXPIRY_HOURS * MS_PER_HOUR;
      const start = options.startsAt?.getTime();
      return new Date(start !== undefined && start < expiry ? start : expiry);
    }
    case "quoted":
      return new Date(from + QUOTE_EXPIRY_DAYS * MS_PER_DAY);
    case "completed_pending_confirmation":
      return new Date(from + COMPLETION_CONFIRMATION_HOURS * MS_PER_HOUR);
    case "disputed":
    case "fix_scheduled": {
      const anchor = options.disputeOpenedAt?.getTime() ?? from;
      return new Date(anchor + FIX_WINDOW_DAYS * MS_PER_DAY);
    }
    default:
      return null;
  }
}

function snapshotDeadline(snapshot: BookingSnapshot): Date | null {
  return deadlineFor(snapshot.state, snapshot.enteredAt, {
    disputeOpenedAt: snapshot.disputeOpenedAt,
    startsAt: snapshot.startsAt,
  });
}

export type TransitionErrorCode =
  /** The event is not valid from the current state. */
  | "invalid_transition"
  /** The state's deadline has passed (e.g. accepting an expired quote). */
  | "deadline_passed"
  /** A timer event fired before its deadline. */
  | "deadline_not_reached"
  /** Marking a job complete before it was scheduled to start. */
  | "job_not_started";

export type TransitionError = {
  code: TransitionErrorCode;
  state: BookingState;
  event: BookingEventType;
  message: string;
  deadline?: Date;
};

export type TransitionResult =
  | {
      ok: true;
      state: BookingState;
      /** Persist as the snapshot's new `enteredAt`. */
      enteredAt: Date;
      /** Persist as the snapshot's `disputeOpenedAt` (unchanged unless a dispute opened). */
      disputeOpenedAt: Date | null;
    }
  | { ok: false; error: TransitionError };

/** Events that must happen strictly before the state's deadline. */
const BEFORE_DEADLINE: ReadonlySet<BookingEventType> = new Set([
  "approve",
  "accept_quote",
  "report_problem",
  "schedule_fix",
  "mark_fixed",
]);
/** Timer events that may fire only once the deadline is reached. */
const AT_DEADLINE: ReadonlySet<BookingEventType> = new Set(["expire", "auto_confirm"]);

function fail(
  snapshot: BookingSnapshot,
  event: BookingEvent,
  code: TransitionErrorCode,
  message: string,
  deadline?: Date,
): TransitionResult {
  return {
    ok: false,
    error: { code, state: snapshot.state, event: event.type, message, deadline },
  };
}

/**
 * Applies `event` to a booking. Pure: returns the next state (and the timestamps to
 * persist) or a typed error; never throws for a disallowed transition.
 */
export function transition(snapshot: BookingSnapshot, event: BookingEvent): TransitionResult {
  assertValidDate(event.at, "event.at");
  const rule = RULES[event.type];
  if (!rule) throw new RangeError(`unknown booking event "${String(event.type)}"`);
  if (!rule.from.includes(snapshot.state)) {
    return fail(
      snapshot,
      event,
      "invalid_transition",
      `cannot ${event.type} a booking that is ${snapshot.state}`,
    );
  }

  const at = event.at.getTime();
  const deadline = snapshotDeadline(snapshot);
  if (deadline && BEFORE_DEADLINE.has(event.type) && at >= deadline.getTime()) {
    return fail(snapshot, event, "deadline_passed", `${event.type} is too late`, deadline);
  }
  if (deadline && AT_DEADLINE.has(event.type) && at < deadline.getTime()) {
    return fail(snapshot, event, "deadline_not_reached", `${event.type} is too early`, deadline);
  }
  if (event.type === "mark_complete" && snapshot.startsAt && at < snapshot.startsAt.getTime()) {
    return fail(snapshot, event, "job_not_started", "the job has not started yet");
  }

  const disputeOpenedAt =
    event.type === "report_problem"
      ? (snapshot.disputeOpenedAt ?? event.at)
      : (snapshot.disputeOpenedAt ?? null);
  return { ok: true, state: rule.to, enteredAt: event.at, disputeOpenedAt };
}

/** Like `transition`, but returns the new snapshot or throws on an invalid transition. */
export function applyBookingEvent(snapshot: BookingSnapshot, event: BookingEvent): BookingSnapshot {
  const result = transition(snapshot, event);
  if (!result.ok) {
    throw new Error(`[${result.error.code}] ${result.error.message}`);
  }
  return {
    state: result.state,
    enteredAt: result.enteredAt,
    startsAt: snapshot.startsAt ?? null,
    disputeOpenedAt: result.disputeOpenedAt,
  };
}

/** The system event a scheduler should apply now, if the state's timer has run out. */
export function dueSystemEvent(
  snapshot: BookingSnapshot,
  now: Date,
): "expire" | "auto_confirm" | null {
  assertValidDate(now, "now");
  const deadline = snapshotDeadline(snapshot);
  if (!deadline || now.getTime() < deadline.getTime()) return null;
  if (snapshot.state === "requested" || snapshot.state === "quoted") return "expire";
  if (snapshot.state === "completed_pending_confirmation") return "auto_confirm";
  return null;
}

/** True once a dispute's fix window has ended without resolution: admin decides. */
export function needsAdminDecision(snapshot: BookingSnapshot, now: Date): boolean {
  assertValidDate(now, "now");
  if (snapshot.state !== "disputed" && snapshot.state !== "fix_scheduled") return false;
  const deadline = snapshotDeadline(snapshot);
  return deadline !== null && now.getTime() >= deadline.getTime();
}
