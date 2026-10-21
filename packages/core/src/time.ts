/**
 * Time-zone helpers. Instants are plain `Date`s (UTC); anything that depends on local
 * days or wall-clock time takes an explicit IANA zone and never uses the host zone.
 */
import { TZDate, tzOffset } from "@date-fns/tz";

export const DEFAULT_TIME_ZONE = "America/Toronto";

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

export type LocalDateTime = {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
};

export function assertValidDate(value: Date, name = "date"): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${name} must be a valid Date`);
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function assertTimeZone(timeZone: string): void {
  if (!isValidTimeZone(timeZone)) throw new RangeError(`unknown time zone "${timeZone}"`);
}

/** Wall-clock components of an instant in `timeZone`. */
export function toLocal(at: Date, timeZone: string = DEFAULT_TIME_ZONE): LocalDateTime {
  assertValidDate(at);
  assertTimeZone(timeZone);
  const local = new TZDate(at.getTime(), timeZone);
  return {
    year: local.getFullYear(),
    month: local.getMonth() + 1,
    day: local.getDate(),
    hour: local.getHours(),
    minute: local.getMinutes(),
    second: local.getSeconds(),
    millisecond: local.getMilliseconds(),
    weekday: local.getDay(),
  };
}

/** UTC offset of `timeZone` at `instant` (ms since epoch), in milliseconds. */
function offsetMs(timeZone: string, instant: number): number {
  // tzOffset reads the zone through Intl (never the host zone) and returns minutes.
  return Math.round(tzOffset(timeZone, new Date(instant)) * 60) * 1000;
}

/**
 * The instant at which the wall clock in `timeZone` shows the given time.
 * A time skipped by a spring-forward gap moves forward by the gap (02:30 -> 03:30);
 * an ambiguous fall-back time resolves to its first (daylight-time) occurrence.
 * Computed from the zone's offsets only, so the result never depends on the host zone.
 */
export function fromLocal(
  local: Pick<LocalDateTime, "year" | "month" | "day"> &
    Partial<Pick<LocalDateTime, "hour" | "minute" | "second" | "millisecond">>,
  timeZone: string = DEFAULT_TIME_ZONE,
): Date {
  assertTimeZone(timeZone);
  // The wall-clock fields read as if they were UTC (out-of-range fields roll over).
  const fields = new Date(0);
  fields.setUTCFullYear(local.year, local.month - 1, local.day);
  fields.setUTCHours(local.hour ?? 0, local.minute ?? 0, local.second ?? 0, local.millisecond ?? 0);
  const wall = fields.getTime();
  if (Number.isNaN(wall)) throw new RangeError("invalid local date-time");
  // The offsets in force a day either side cover any transition near this time.
  const offsetBefore = offsetMs(timeZone, wall - MS_PER_DAY);
  const offsetAfter = offsetMs(timeZone, wall + MS_PER_DAY);
  const matches = [wall - offsetBefore, wall - offsetAfter]
    .filter((instant) => offsetMs(timeZone, instant) === wall - instant)
    .sort((a, b) => a - b);
  const first = matches[0];
  if (first !== undefined) return new Date(first);
  // Skipped by a spring-forward gap: reading the time with the earlier offset lands
  // just after the transition, i.e. the wall-clock time moved forward by the gap.
  return new Date(wall - offsetBefore);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type CalendarDate = { year: number; month: number; day: number };

/** Parses a real calendar date written as YYYY-MM-DD, or returns null. */
export function parseIsoDate(value: string): CalendarDate | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

export function formatIsoDate(date: CalendarDate): string {
  const y = String(date.year).padStart(4, "0");
  const m = String(date.month).padStart(2, "0");
  const d = String(date.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The local calendar date (YYYY-MM-DD) of an instant in `timeZone`. */
export function localDateString(at: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  return formatIsoDate(toLocal(at, timeZone));
}

/** Number of days in `month` (1–12) of `year`. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Adds whole calendar days to a calendar date (no time zone involved). */
export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Day of week (0 = Sunday) of a calendar date. */
export function weekdayOf(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/**
 * Moves an instant by whole calendar days in `timeZone`, keeping its wall-clock time
 * (so "3 days before 09:00" is 09:00 even across a DST change).
 */
export function addLocalDays(at: Date, days: number, timeZone: string = DEFAULT_TIME_ZONE): Date {
  const local = toLocal(at, timeZone);
  const date = addCalendarDays(local, days);
  return fromLocal({ ...local, ...date }, timeZone);
}

export function addMilliseconds(at: Date, ms: number): Date {
  assertValidDate(at);
  return new Date(at.getTime() + ms);
}
