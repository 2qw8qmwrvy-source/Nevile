/**
 * When customers are charged and when businesses are paid — SPEC §7.
 *
 * Charges:
 * - one-off job: upfront, when the booking is confirmed;
 * - recurring visit: 3 calendar days before the visit, at the same local wall-clock time
 *   (or immediately at confirmation if that moment has already passed);
 * - snow-contract visit: once the visit is confirmed complete — by the customer, by the
 *   48h auto-confirm, or by an admin releasing a dispute. Pending confirmation, it is
 *   due at the auto-confirm time (48h after it last entered pending confirmation, so a
 *   fixed visit restarts the clock). A disputed visit, or one with a fix scheduled, is
 *   not charged until it is resolved.
 *
 * Payouts run as a weekly batch every Monday (America/Toronto). The cut-off is the end of
 * Sunday local time: a visit confirmed complete at any time up to Sunday 23:59:59.999 is
 * paid the following Monday; one confirmed on Monday itself waits for the next Monday.
 */
import { type BookingSnapshot, deadlineFor } from "./booking-lifecycle.ts";
import {
  addCalendarDays,
  addLocalDays,
  assertValidDate,
  type CalendarDate,
  DEFAULT_TIME_ZONE,
  formatIsoDate,
  fromLocal,
  parseIsoDate,
  toLocal,
  weekdayOf,
} from "./time.ts";

export const RECURRING_CHARGE_DAYS_BEFORE = 3;
export const PAYOUT_TIME_ZONE = "America/Toronto";
/** Day of week the payout batch runs (0 = Sunday, 1 = Monday). */
export const PAYOUT_WEEKDAY = 1;

export type ChargeTimingInput =
  | { kind: "one_off"; confirmedAt: Date }
  | {
      kind: "recurring_visit";
      visitStartsAt: Date;
      /** When the series (or this visit) was confirmed; the charge is never earlier. */
      confirmedAt?: Date;
      /** IANA zone of the job address. */
      timeZone?: string;
    }
  | {
      kind: "snow_contract_visit";
      /** The visit's lifecycle state and when it entered that state. */
      visit: Pick<BookingSnapshot, "state" | "enteredAt">;
    };

export type ChargeKind = ChargeTimingInput["kind"];

type ScheduledChargeInput = Exclude<ChargeTimingInput, { kind: "snow_contract_visit" }>;

/**
 * The instant the customer's saved card should be charged. For a snow-contract visit,
 * null means "not chargeable now": not yet done, disputed / fix scheduled, cancelled or
 * refunded.
 */
export function chargeAtFor(input: ScheduledChargeInput): Date;
export function chargeAtFor(input: ChargeTimingInput): Date | null;
export function chargeAtFor(input: ChargeTimingInput): Date | null {
  switch (input.kind) {
    case "one_off":
      assertValidDate(input.confirmedAt, "confirmedAt");
      return new Date(input.confirmedAt.getTime());
    case "recurring_visit": {
      assertValidDate(input.visitStartsAt, "visitStartsAt");
      const scheduled = addLocalDays(
        input.visitStartsAt,
        -RECURRING_CHARGE_DAYS_BEFORE,
        input.timeZone ?? DEFAULT_TIME_ZONE,
      );
      if (input.confirmedAt) {
        assertValidDate(input.confirmedAt, "confirmedAt");
        if (input.confirmedAt.getTime() > scheduled.getTime()) {
          return new Date(input.confirmedAt.getTime());
        }
      }
      return scheduled;
    }
    case "snow_contract_visit": {
      const { state, enteredAt } = input.visit;
      assertValidDate(enteredAt, "visit.enteredAt");
      // Confirmed by the customer, auto-confirmed, or released by an admin.
      if (state === "completed") return new Date(enteredAt.getTime());
      // Due when it auto-confirms; an earlier customer confirmation moves it to `completed`.
      if (state === "completed_pending_confirmation") return deadlineFor(state, enteredAt);
      return null;
    }
    default:
      throw new RangeError("unknown charge kind");
  }
}

export type PayoutBatch = {
  /** Local date (YYYY-MM-DD, a Monday in the payout zone) of the payout batch. */
  payoutDate: string;
  /** Visits confirmed at or after this instant belong to this batch… */
  confirmedFrom: Date;
  /** …and strictly before this one (Monday 00:00 local, the end of Sunday). */
  cutoffAt: Date;
};

function batchForMonday(monday: CalendarDate, zone: string): PayoutBatch {
  const previous = addCalendarDays(monday, -7);
  return {
    payoutDate: formatIsoDate(monday),
    confirmedFrom: fromLocal(previous, zone),
    cutoffAt: fromLocal(monday, zone),
  };
}

/** The payout batch that pays out a visit confirmed complete at `confirmedCompleteAt`. */
export function payoutBatchFor(
  confirmedCompleteAt: Date,
  timeZone: string = PAYOUT_TIME_ZONE,
): PayoutBatch {
  const local = toLocal(confirmedCompleteAt, timeZone);
  // Days until the next Monday strictly after the local date (Monday itself → 7).
  const daysAhead = (PAYOUT_WEEKDAY - local.weekday + 7) % 7 || 7;
  return batchForMonday(addCalendarDays(local, daysAhead), timeZone);
}

/** The confirmation window covered by the batch paid on `payoutDate` (a Monday). */
export function payoutBatchOn(
  payoutDate: string,
  timeZone: string = PAYOUT_TIME_ZONE,
): PayoutBatch {
  const date = parseIsoDate(payoutDate);
  if (!date) throw new RangeError(`payoutDate must be YYYY-MM-DD, got "${payoutDate}"`);
  if (weekdayOf(date) !== PAYOUT_WEEKDAY) {
    throw new RangeError(`payoutDate must be a Monday, got ${payoutDate}`);
  }
  return batchForMonday(date, timeZone);
}
