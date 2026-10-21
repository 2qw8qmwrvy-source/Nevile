/**
 * Recurring visit series — SPEC §4 "Recurring jobs": weekly, every 2 weeks or monthly,
 * with an end date.
 *
 * Occurrences keep the first visit's wall-clock time in the job's zone, so a 09:00 visit
 * stays at 09:00 across DST changes. Monthly series repeat on the first visit's day of
 * the month; on days 29–31 they clamp to the end of shorter months (Jan 31 → Feb 28 →
 * Mar 31) without drifting. A wall-clock time that does not exist on a given day (spring
 * forward) moves forward by the gap; an ambiguous one (fall back) uses the first instant.
 */
import {
  type CalendarDate,
  DEFAULT_TIME_ZONE,
  addCalendarDays,
  assertValidDate,
  daysInMonth,
  formatIsoDate,
  fromLocal,
  localDateString,
  parseIsoDate,
  toLocal,
} from "./time.ts";

export const RECURRENCE_FREQUENCIES = ["weekly", "biweekly", "monthly"] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export const DEFAULT_MAX_OCCURRENCES = 100;
/** Hard ceiling on a single generation call. */
export const MAX_OCCURRENCES_LIMIT = 1000;

export type RecurrenceInput = {
  frequency: RecurrenceFrequency;
  /** Start of the first visit. */
  firstStartsAt: Date;
  /** IANA zone of the job address. */
  timeZone?: string;
  /**
   * Last day of the series, inclusive, as a local calendar date. A `Date` is converted to
   * its local date in `timeZone`. Omit for an open series bounded only by `maxCount`.
   */
  endDate?: string | Date;
  /** Maximum number of occurrences returned (including the first). */
  maxCount?: number;
};

function nthDate(first: CalendarDate, frequency: RecurrenceFrequency, n: number): CalendarDate {
  switch (frequency) {
    case "weekly":
      return addCalendarDays(first, 7 * n);
    case "biweekly":
      return addCalendarDays(first, 14 * n);
    case "monthly": {
      const monthIndex = first.month - 1 + n;
      const year = first.year + Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      return { year, month, day: Math.min(first.day, daysInMonth(year, month)) };
    }
  }
}

/** Start instants of the visits in a series, in order. */
export function generateOccurrences(input: RecurrenceInput): Date[] {
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  assertValidDate(input.firstStartsAt, "firstStartsAt");
  const maxCount = input.maxCount ?? DEFAULT_MAX_OCCURRENCES;
  if (!Number.isInteger(maxCount) || maxCount < 1 || maxCount > MAX_OCCURRENCES_LIMIT) {
    throw new RangeError(`maxCount must be an integer from 1 to ${MAX_OCCURRENCES_LIMIT}`);
  }
  if (!(RECURRENCE_FREQUENCIES as readonly string[]).includes(input.frequency)) {
    throw new RangeError(`unknown frequency "${String(input.frequency)}"`);
  }

  let endDate: string | undefined;
  if (input.endDate instanceof Date) {
    endDate = localDateString(input.endDate, timeZone);
  } else if (input.endDate !== undefined) {
    if (!parseIsoDate(input.endDate)) {
      throw new RangeError(`endDate must be YYYY-MM-DD, got "${input.endDate}"`);
    }
    endDate = input.endDate;
  }

  const first = toLocal(input.firstStartsAt, timeZone);
  const occurrences: Date[] = [];
  for (let n = 0; occurrences.length < maxCount; n++) {
    const date = nthDate(first, input.frequency, n);
    if (endDate !== undefined && formatIsoDate(date) > endDate) break;
    occurrences.push(n === 0 ? new Date(input.firstStartsAt.getTime()) : fromLocal({ ...first, ...date }, timeZone));
  }
  return occurrences;
}
