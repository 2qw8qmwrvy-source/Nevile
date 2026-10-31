import { describe, expect, it } from "vitest";
import {
  applyBookingEvent,
  BOOKING_EVENT_ACTORS,
  BOOKING_EVENT_TYPES,
  BOOKING_STATES,
  type BookingEventType,
  type BookingSnapshot,
  type BookingState,
  deadlineFor,
  dueSystemEvent,
  eventsFrom,
  initialBookingState,
  isBookingState,
  isTerminalBookingState,
  needsAdminDecision,
  TERMINAL_BOOKING_STATES,
  transition,
} from "./booking-lifecycle.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = new Date("2026-10-01T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const snap = (state: BookingState, extra: Partial<BookingSnapshot> = {}): BookingSnapshot => ({
  state,
  enteredAt: T0,
  ...extra,
});

function expectError(
  snapshot: BookingSnapshot,
  type: BookingEventType,
  when: Date,
  code: string,
): void {
  const result = transition(snapshot, { type, at: when });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

describe("states and events", () => {
  it("lists every state, with the terminal ones flagged", () => {
    expect(BOOKING_STATES).toHaveLength(13);
    for (const state of TERMINAL_BOOKING_STATES) {
      expect(isTerminalBookingState(state)).toBe(true);
      expect(eventsFrom(state)).toEqual([]);
    }
    expect(isTerminalBookingState("confirmed")).toBe(false);
  });

  it("every non-terminal state has a way out", () => {
    for (const state of BOOKING_STATES) {
      if (!isTerminalBookingState(state)) expect(eventsFrom(state).length).toBeGreaterThan(0);
    }
  });

  it("recognises states", () => {
    expect(isBookingState("quoted")).toBe(true);
    expect(isBookingState("pending")).toBe(false);
  });

  it("assigns an actor to every event", () => {
    expect(Object.keys(BOOKING_EVENT_ACTORS).sort()).toEqual([...BOOKING_EVENT_TYPES].sort());
    expect(BOOKING_EVENT_ACTORS.approve).toBe("business");
    expect(BOOKING_EVENT_ACTORS.accept_quote).toBe("customer");
    expect(BOOKING_EVENT_ACTORS.expire).toBe("system");
    expect(BOOKING_EVENT_ACTORS.auto_confirm).toBe("system");
    expect(BOOKING_EVENT_ACTORS.admin_refund).toBe("admin");
  });

  it("chooses the initial state from pricing and instant book", () => {
    expect(initialBookingState({ pricingType: "quote", instantBook: true })).toBe(
      "quote_requested",
    );
    expect(initialBookingState({ pricingType: "fixed", instantBook: true })).toBe("confirmed");
    expect(initialBookingState({ pricingType: "fixed", instantBook: false })).toBe("requested");
  });

  it("returns invalid_transition for every structurally disallowed pair", () => {
    for (const state of BOOKING_STATES) {
      const allowed = eventsFrom(state);
      for (const type of BOOKING_EVENT_TYPES) {
        const result = transition(snap(state), { type, at: at(HOUR) });
        if (!allowed.includes(type)) {
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error).toMatchObject({ code: "invalid_transition", state, event: type });
          }
        }
      }
    }
  });

  it("throws on an unknown event type", () => {
    expect(() =>
      transition(snap("confirmed"), { type: "explode" as BookingEventType, at: T0 }),
    ).toThrow(RangeError);
  });

  it("throws on an invalid event time", () => {
    expect(() =>
      transition(snap("confirmed"), { type: "mark_complete", at: new Date("x") }),
    ).toThrow(RangeError);
  });
});

describe("happy paths", () => {
  it("fixed price with approval: request → approve → complete → confirm", () => {
    let booking: BookingSnapshot = snap("requested", { startsAt: at(3 * DAY) });
    booking = applyBookingEvent(booking, { type: "approve", at: at(2 * HOUR) });
    expect(booking.state).toBe("confirmed");
    expect(booking.enteredAt).toEqual(at(2 * HOUR));
    booking = applyBookingEvent(booking, { type: "mark_complete", at: at(3 * DAY + 2 * HOUR) });
    expect(booking.state).toBe("completed_pending_confirmation");
    booking = applyBookingEvent(booking, {
      type: "confirm_completion",
      at: at(3 * DAY + 5 * HOUR),
    });
    expect(booking.state).toBe("completed");
    expect(booking.disputeOpenedAt).toBeNull();
  });

  it("quote: request → quote → accept", () => {
    let booking = snap("quote_requested");
    booking = applyBookingEvent(booking, { type: "send_quote", at: at(HOUR) });
    expect(booking.state).toBe("quoted");
    booking = applyBookingEvent(booking, { type: "accept_quote", at: at(2 * DAY) });
    expect(booking.state).toBe("confirmed");
  });

  it("re-sending a quote restarts the 7-day clock", () => {
    let booking = snap("quoted");
    booking = applyBookingEvent(booking, { type: "send_quote", at: at(6 * DAY) });
    expect(booking.enteredAt).toEqual(at(6 * DAY));
    const accepted = transition(booking, { type: "accept_quote", at: at(12 * DAY) });
    expect(accepted.ok && accepted.state).toBe("confirmed");
  });

  it("silence auto-confirms after 48h", () => {
    const booking = snap("completed_pending_confirmation");
    expect(dueSystemEvent(booking, at(48 * HOUR))).toBe("auto_confirm");
    const result = transition(booking, { type: "auto_confirm", at: at(48 * HOUR) });
    expect(result.ok && result.state).toBe("completed");
  });

  it("cancellations by each side", () => {
    for (const state of ["requested", "quote_requested", "quoted", "confirmed"] as const) {
      const result = transition(snap(state), { type: "cancel_by_customer", at: at(HOUR) });
      expect(result.ok && result.state).toBe("cancelled_by_customer");
    }
    const business = transition(snap("confirmed"), { type: "cancel_by_business", at: at(HOUR) });
    expect(business.ok && business.state).toBe("cancelled_by_business");
    expectError(snap("requested"), "cancel_by_business", at(HOUR), "invalid_transition");
    expectError(
      snap("completed_pending_confirmation"),
      "cancel_by_customer",
      at(HOUR),
      "invalid_transition",
    );
  });

  it("the customer cannot cancel a confirmed job once it has started", () => {
    const startsAt = at(DAY);
    const booking = snap("confirmed", { startsAt });
    expect(transition(booking, { type: "cancel_by_customer", at: at(DAY - 1) }).ok).toBe(true);
    expectError(booking, "cancel_by_customer", startsAt, "job_started");
    expectError(booking, "cancel_by_customer", at(DAY + 5 * HOUR), "job_started");
    // Without a known start time the guard is skipped.
    expect(transition(snap("confirmed"), { type: "cancel_by_customer", at: at(DAY) }).ok).toBe(
      true,
    );
    // Withdrawing an unconfirmed request costs nothing, so it stays allowed.
    for (const state of ["requested", "quote_requested", "quoted"] as const) {
      const late = transition(snap(state, { startsAt }), {
        type: "cancel_by_customer",
        at: at(2 * DAY),
      });
      expect(late.ok && late.state).toBe("cancelled_by_customer");
    }
  });

  it("a no-show after the start is a business cancellation or an admin refund", () => {
    const booking = snap("confirmed", { startsAt: at(DAY) });
    const business = transition(booking, { type: "cancel_by_business", at: at(DAY + HOUR) });
    expect(business.ok && business.state).toBe("cancelled_by_business");
    const admin = transition(booking, { type: "admin_refund", at: at(DAY + HOUR) });
    expect(admin.ok && admin.state).toBe("refunded");
  });

  it("declining is separate from cancelling", () => {
    for (const state of ["requested", "quote_requested", "quoted"] as const) {
      const result = transition(snap(state), { type: "decline", at: at(HOUR) });
      expect(result.ok && result.state).toBe("declined");
    }
    expectError(snap("confirmed"), "decline", at(HOUR), "invalid_transition");
  });
});

describe("approval expiry (24h)", () => {
  const requested = snap("requested");

  it("allows approval up to the last millisecond", () => {
    expect(transition(requested, { type: "approve", at: at(24 * HOUR - 1) }).ok).toBe(true);
  });

  it("rejects approval at exactly 24h", () => {
    const result = transition(requested, { type: "approve", at: at(24 * HOUR) });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "deadline_passed",
        state: "requested",
        event: "approve",
        message: "approve is too late",
        deadline: at(24 * HOUR),
      },
    });
  });

  it("expires at exactly 24h, not before", () => {
    expectError(requested, "expire", at(24 * HOUR - 1), "deadline_not_reached");
    const result = transition(requested, { type: "expire", at: at(24 * HOUR) });
    expect(result.ok && result.state).toBe("expired");
    expect(dueSystemEvent(requested, at(24 * HOUR - 1))).toBeNull();
    expect(dueSystemEvent(requested, at(24 * HOUR))).toBe("expire");
  });

  it("is capped at the job start when that comes first", () => {
    const soon = snap("requested", { startsAt: at(10 * HOUR) });
    expect(deadlineFor("requested", T0, { startsAt: at(10 * HOUR) })).toEqual(at(10 * HOUR));
    expectError(soon, "approve", at(10 * HOUR), "deadline_passed");
    expect(dueSystemEvent(soon, at(10 * HOUR))).toBe("expire");
    // A later start does not extend the 24h window.
    expect(deadlineFor("requested", T0, { startsAt: at(5 * DAY) })).toEqual(at(24 * HOUR));
  });
});

describe("quote expiry (7 days)", () => {
  const quoted = snap("quoted");

  it("allows acceptance until just before 7 days", () => {
    expect(transition(quoted, { type: "accept_quote", at: at(7 * DAY - 1) }).ok).toBe(true);
    expectError(quoted, "accept_quote", at(7 * DAY), "deadline_passed");
  });

  it("expires at 7 days", () => {
    expectError(quoted, "expire", at(7 * DAY - 1), "deadline_not_reached");
    expect(dueSystemEvent(quoted, at(7 * DAY))).toBe("expire");
  });

  it("is capped at the job start: a quote cannot be accepted for a slot already past", () => {
    const startsAt = at(DAY);
    const nearJob = snap("quoted", { startsAt });
    expect(deadlineFor("quoted", T0, { startsAt })).toEqual(startsAt);
    expect(transition(nearJob, { type: "accept_quote", at: at(DAY - 1) }).ok).toBe(true);
    expectError(nearJob, "accept_quote", startsAt, "deadline_passed");
    expectError(nearJob, "accept_quote", at(2 * DAY), "deadline_passed");
    expect(dueSystemEvent(nearJob, startsAt)).toBe("expire");
    // A later start does not extend the 7-day window.
    expect(deadlineFor("quoted", T0, { startsAt: at(30 * DAY) })).toEqual(at(7 * DAY));
  });

  it("quote requests themselves never expire", () => {
    expect(deadlineFor("quote_requested", T0)).toBeNull();
    expect(dueSystemEvent(snap("quote_requested"), at(365 * DAY))).toBeNull();
    expectError(snap("quote_requested"), "expire", at(365 * DAY), "invalid_transition");
  });
});

describe("completion", () => {
  it("cannot be marked complete before the job starts", () => {
    const booking = snap("confirmed", { startsAt: at(DAY) });
    expectError(booking, "mark_complete", at(DAY - 1), "job_not_started");
    expect(transition(booking, { type: "mark_complete", at: at(DAY) }).ok).toBe(true);
    // Without a known start time the guard is skipped.
    expect(transition(snap("confirmed"), { type: "mark_complete", at: T0 }).ok).toBe(true);
  });

  it("problems can be reported only inside the 48h window", () => {
    const pending = snap("completed_pending_confirmation");
    expectError(pending, "auto_confirm", at(48 * HOUR - 1), "deadline_not_reached");
    expectError(pending, "report_problem", at(48 * HOUR), "deadline_passed");
    const result = transition(pending, { type: "report_problem", at: at(47 * HOUR) });
    expect(result).toEqual({
      ok: true,
      state: "disputed",
      enteredAt: at(47 * HOUR),
      disputeOpenedAt: at(47 * HOUR),
    });
  });

  it("the customer may still confirm after the window (same outcome as auto-confirm)", () => {
    const result = transition(snap("completed_pending_confirmation"), {
      type: "confirm_completion",
      at: at(5 * DAY),
    });
    expect(result.ok && result.state).toBe("completed");
  });
});

describe("disputes", () => {
  const disputedAt = at(10 * HOUR);
  const disputed: BookingSnapshot = {
    state: "disputed",
    enteredAt: disputedAt,
    disputeOpenedAt: disputedAt,
  };
  const fixDeadline = new Date(disputedAt.getTime() + 3 * DAY);

  it("gives the business 3 days from the dispute to fix it", () => {
    expect(deadlineFor("disputed", disputedAt)).toEqual(fixDeadline);
    expect(
      transition(disputed, { type: "schedule_fix", at: new Date(fixDeadline.getTime() - 1) }).ok,
    ).toBe(true);
    expectError(disputed, "schedule_fix", fixDeadline, "deadline_passed");
  });

  it("measures the fix window from the dispute, not from scheduling the fix", () => {
    const scheduled = applyBookingEvent(disputed, { type: "schedule_fix", at: at(2 * DAY) });
    expect(scheduled.state).toBe("fix_scheduled");
    expect(scheduled.disputeOpenedAt).toEqual(disputedAt);
    expect(deadlineFor("fix_scheduled", scheduled.enteredAt, scheduled)).toEqual(fixDeadline);
    expectError(scheduled, "mark_fixed", fixDeadline, "deadline_passed");
    expect(needsAdminDecision(scheduled, new Date(fixDeadline.getTime() - 1))).toBe(false);
    expect(needsAdminDecision(scheduled, fixDeadline)).toBe(true);
  });

  it("after a fix the customer confirms again; a second report keeps the original anchor", () => {
    let booking = applyBookingEvent(disputed, { type: "schedule_fix", at: at(DAY) });
    booking = applyBookingEvent(booking, { type: "mark_fixed", at: at(2 * DAY) });
    expect(booking.state).toBe("completed_pending_confirmation");
    booking = applyBookingEvent(booking, { type: "report_problem", at: at(3 * DAY) });
    expect(booking.state).toBe("disputed");
    expect(booking.disputeOpenedAt).toEqual(disputedAt);
    // The original fix window has run out, so this one goes straight to admin.
    expect(needsAdminDecision(booking, at(3 * DAY + 10 * HOUR))).toBe(true);
    expectError(booking, "schedule_fix", at(3 * DAY + 10 * HOUR), "deadline_passed");
  });

  it("the customer can close a dispute by confirming", () => {
    for (const state of ["disputed", "fix_scheduled"] as const) {
      const result = transition(
        { ...disputed, state },
        { type: "confirm_completion", at: at(DAY) },
      );
      expect(result.ok && result.state).toBe("completed");
    }
  });

  it("admin decides once the fix window has ended: release payout or refund", () => {
    const release = transition(disputed, { type: "admin_release_payout", at: fixDeadline });
    expect(release.ok && release.state).toBe("completed");
    const refund = transition(disputed, { type: "admin_refund", at: at(5 * DAY) });
    expect(refund.ok && refund.state).toBe("refunded");
  });

  it("keeps the business's fix window: no admin decision before it ends", () => {
    const early = new Date(fixDeadline.getTime() - 1);
    const scheduled: BookingSnapshot = { ...disputed, state: "fix_scheduled", enteredAt: at(DAY) };
    for (const snapshot of [disputed, scheduled]) {
      for (const type of ["admin_refund", "admin_release_payout"] as const) {
        expect(needsAdminDecision(snapshot, early)).toBe(false);
        const result = transition(snapshot, { type, at: early });
        expect(result).toMatchObject({
          ok: false,
          error: { code: "deadline_not_reached", deadline: fixDeadline },
        });
      }
    }
  });

  it("lets an admin act inside the fix window only with an explicit override", () => {
    const result = transition(disputed, {
      type: "admin_refund",
      at: disputedAt,
      adminOverride: true,
    });
    expect(result.ok && result.state).toBe("refunded");
  });

  it("does not hold admin refunds of undisputed bookings to a fix window", () => {
    expect(transition(snap("confirmed"), { type: "admin_refund", at: T0 }).ok).toBe(true);
    expect(
      transition(snap("completed_pending_confirmation"), { type: "admin_refund", at: T0 }).ok,
    ).toBe(true);
  });

  it("needs no admin decision outside disputes", () => {
    expect(needsAdminDecision(snap("confirmed"), at(100 * DAY))).toBe(false);
    expect(needsAdminDecision(snap("completed"), at(100 * DAY))).toBe(false);
  });

  it("has no system timer event for disputes", () => {
    expect(dueSystemEvent(disputed, at(100 * DAY))).toBeNull();
  });
});

describe("deadlineFor", () => {
  it.each<[BookingState, number | null]>([
    ["requested", 24 * HOUR],
    ["quoted", 7 * DAY],
    ["completed_pending_confirmation", 48 * HOUR],
    ["disputed", 3 * DAY],
    ["fix_scheduled", 3 * DAY],
    ["quote_requested", null],
    ["confirmed", null],
    ["completed", null],
    ["cancelled_by_customer", null],
    ["cancelled_by_business", null],
    ["declined", null],
    ["expired", null],
    ["refunded", null],
  ])("%s", (state, offset) => {
    expect(deadlineFor(state, T0)).toEqual(offset === null ? null : at(offset));
  });

  it("uses elapsed time across DST (24h after 12:00 EDT the day before fall back)", () => {
    const entered = new Date("2026-10-31T16:00:00Z");
    expect(deadlineFor("requested", entered)?.toISOString()).toBe("2026-11-01T16:00:00.000Z");
  });

  it("rejects an invalid enteredAt", () => {
    expect(() => deadlineFor("quoted", new Date("bad"))).toThrow(RangeError);
  });
});

describe("applyBookingEvent", () => {
  it("throws with the error code on an invalid transition", () => {
    expect(() => applyBookingEvent(snap("completed"), { type: "approve", at: T0 })).toThrow(
      /invalid_transition/,
    );
  });

  it("preserves the start time", () => {
    const next = applyBookingEvent(snap("requested", { startsAt: at(DAY) }), {
      type: "approve",
      at: at(HOUR),
    });
    expect(next.startsAt).toEqual(at(DAY));
  });
});
