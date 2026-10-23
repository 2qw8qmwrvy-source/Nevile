/**
 * Arrival windows, working hours and capacity (SPEC §19). Pure: callers load a business's
 * windows, its crew's hours and time off and the work already placed, and get back the
 * windows a job of a given length fits in.
 *
 * Capacity is by time and pooled across the crew: each member adds the minutes of a window
 * inside their working hours (minus time off). A job takes up to one window's length from
 * its own window and spills the rest into the following windows of the same day.
 */
import { z } from "zod";
import { hasDisallowedControlCharacters } from "./listing.ts";
import { launchPostalCodeSchema } from "./region.ts";
import {
  addCalendarDays,
  type CalendarDate,
  DEFAULT_TIME_ZONE,
  formatIsoDate,
  fromLocal,
  MS_PER_DAY,
  MS_PER_MINUTE,
  parseIsoDate,
  toLocal,
  weekdayOf,
} from "./time.ts";

/** A window of the day, in minutes from local midnight (8 am = 480). */
export type ArrivalWindow = { startMinute: number; endMinute: number };

/** 8–11 am, 11 am–2 pm, 2–5 pm. */
export const DEFAULT_ARRIVAL_WINDOWS: readonly ArrivalWindow[] = [
  { startMinute: 480, endMinute: 660 },
  { startMinute: 660, endMinute: 840 },
  { startMinute: 840, endMinute: 1020 },
];

export const ARRIVAL_WINDOW_LIMITS = {
  maxWindows: 6,
  minMinutes: 60,
  maxMinutes: 360,
  /** 6 am to 9 pm. */
  earliestMinute: 360,
  latestMinute: 1260,
  stepMinutes: 15,
} as const;

/** One weekday's working span. Weekday: 0 = Sunday … 6 = Saturday. */
export type WorkingHours = { weekday: number; startMinute: number; endMinute: number };

/** Monday–Friday, 8 am–5 pm. */
export const DEFAULT_WORKING_HOURS: readonly WorkingHours[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startMinute: 480,
  endMinute: 1020,
}));

export const BOOKING_NOTICE_LIMITS = {
  /** Earliest bookable day, in days from today (0 = today). */
  minNoticeDays: { min: 0, max: 14, default: 1 },
  /** Latest bookable day, in days from today. */
  maxDaysAhead: { min: 7, max: 180, default: 60 },
  /** With same-day booking on, a window must start at least this long from now. */
  sameDayLeadMinutes: 120,
} as const;

/** An unpaid checkout holds its time this long (SPEC §19). */
export const CHECKOUT_HOLD_MINUTES = 30;
/** Days a business has to finish payout setup after its first paid booking. */
export const PAYOUT_SETUP_DAYS = 7;
export const CUSTOMER_NOTES_MAX_LENGTH = 500;
/** Crew invite links stay valid this long. */
export const CREW_INVITE_DAYS = 7;

const minuteOfDay = z.number().int().min(0).max(1440);
const onStep = (minute: number) => minute % ARRIVAL_WINDOW_LIMITS.stepMinutes === 0;

export const arrivalWindowsSchema = z
  .array(z.object({ startMinute: minuteOfDay, endMinute: minuteOfDay }))
  .min(1, { message: "Add at least one arrival window" })
  .max(ARRIVAL_WINDOW_LIMITS.maxWindows, {
    message: `Use at most ${ARRIVAL_WINDOW_LIMITS.maxWindows} arrival windows`,
  })
  .superRefine((windows, ctx) => {
    const sorted = [...windows].sort((a, b) => a.startMinute - b.startMinute);
    sorted.forEach((window, index) => {
      const length = window.endMinute - window.startMinute;
      if (!onStep(window.startMinute) || !onStep(window.endMinute)) {
        ctx.addIssue({ code: "custom", message: "Windows start and end on 15-minute marks" });
      } else if (
        window.startMinute < ARRIVAL_WINDOW_LIMITS.earliestMinute ||
        window.endMinute > ARRIVAL_WINDOW_LIMITS.latestMinute
      ) {
        ctx.addIssue({ code: "custom", message: "Windows must be between 6 am and 9 pm" });
      } else if (
        length < ARRIVAL_WINDOW_LIMITS.minMinutes ||
        length > ARRIVAL_WINDOW_LIMITS.maxMinutes
      ) {
        ctx.addIssue({ code: "custom", message: "Each window is 1 to 6 hours long" });
      }
      const next = sorted[index + 1];
      if (next && next.startMinute < window.endMinute) {
        ctx.addIssue({ code: "custom", message: "Windows can't overlap" });
      }
    });
  })
  .transform((windows) => [...windows].sort((a, b) => a.startMinute - b.startMinute));

export const workingHoursSchema = z
  .array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      startMinute: minuteOfDay,
      endMinute: minuteOfDay,
    }),
  )
  .max(7)
  .superRefine((hours, ctx) => {
    const seen = new Set<number>();
    for (const span of hours) {
      if (seen.has(span.weekday)) {
        ctx.addIssue({ code: "custom", message: "Set one span of hours per day" });
      }
      seen.add(span.weekday);
      if (!onStep(span.startMinute) || !onStep(span.endMinute)) {
        ctx.addIssue({ code: "custom", message: "Hours start and end on 15-minute marks" });
      }
      if (span.endMinute <= span.startMinute) {
        ctx.addIssue({ code: "custom", message: "The end time must be after the start time" });
      }
    }
  })
  .transform((hours) => [...hours].sort((a, b) => a.weekday - b.weekday));

export const bookingNoticeSchema = z.object({
  minNoticeDays: z
    .number()
    .int()
    .min(BOOKING_NOTICE_LIMITS.minNoticeDays.min)
    .max(BOOKING_NOTICE_LIMITS.minNoticeDays.max),
  maxDaysAhead: z
    .number()
    .int()
    .min(BOOKING_NOTICE_LIMITS.maxDaysAhead.min)
    .max(BOOKING_NOTICE_LIMITS.maxDaysAhead.max),
});

const meridiem = (minute: number) => (minute % 1440 < 720 ? "am" : "pm");

/** 480 → "8", 690 → "11:30", 720 → "12", 1440 → "12". */
function clock(minute: number): string {
  const hour24 = Math.floor(minute / 60) % 24;
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const rest = minute % 60;
  return rest === 0 ? String(hour) : `${hour}:${String(rest).padStart(2, "0")}`;
}

/** 480 → "8 am", 750 → "12:30 pm". */
export function formatMinuteOfDay(minute: number): string {
  return `${clock(minute)} ${meridiem(minute)}`;
}

/** "8–11 am", "11 am–2 pm". */
export function formatArrivalWindow(window: ArrivalWindow): string {
  const start = meridiem(window.startMinute);
  const end = meridiem(window.endMinute);
  return start === end
    ? `${clock(window.startMinute)}–${clock(window.endMinute)} ${end}`
    : `${formatMinuteOfDay(window.startMinute)}–${formatMinuteOfDay(window.endMinute)}`;
}

/** A window on a particular day. */
export type WindowSlot = ArrivalWindow & {
  /** Local date, YYYY-MM-DD. */
  date: string;
  startsAt: Date;
  endsAt: Date;
};

function atMinute(date: CalendarDate, minute: number, timeZone: string): Date {
  return fromLocal(
    { year: date.year, month: date.month, day: date.day, hour: 0, minute },
    timeZone,
  );
}

/** The day's arrival windows as instants, earliest first. */
export function windowSlotsForDate(
  date: CalendarDate,
  windows: readonly ArrivalWindow[],
  timeZone: string = DEFAULT_TIME_ZONE,
): WindowSlot[] {
  return [...windows]
    .sort((a, b) => a.startMinute - b.startMinute)
    .map((window) => ({
      ...window,
      date: formatIsoDate(date),
      startsAt: atMinute(date, window.startMinute, timeZone),
      endsAt: atMinute(date, window.endMinute, timeZone),
    }));
}

export type TimeOff = { startsAt: Date; endsAt: Date };

/** A crew member's weekly hours and time off. */
export type MemberAvailability = {
  memberId: string;
  hours: readonly WorkingHours[];
  timeOff: readonly TimeOff[];
};

/** Length of [start, end) not covered by any of `blocks`, in minutes. */
function uncoveredMinutes(start: number, end: number, blocks: readonly TimeOff[]): number {
  const overlaps = blocks
    .map((block) => [
      Math.max(start, block.startsAt.getTime()),
      Math.min(end, block.endsAt.getTime()),
    ])
    .filter(([from, to]) => (to ?? 0) > (from ?? 0))
    .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  let covered = 0;
  let cursor = start;
  for (const [from = 0, to = 0] of overlaps) {
    const begin = Math.max(from, cursor);
    if (to > begin) {
      covered += to - begin;
      cursor = to;
    }
  }
  return Math.max(0, Math.round((end - start - covered) / MS_PER_MINUTE));
}

/** Minutes of `slot` the member can work. */
export function memberMinutesInSlot(
  slot: WindowSlot,
  member: MemberAvailability,
  timeZone: string = DEFAULT_TIME_ZONE,
): number {
  const date = parseIsoDate(slot.date);
  if (!date) return 0;
  const span = member.hours.find((hours) => hours.weekday === weekdayOf(date));
  if (!span) return 0;
  const from = Math.max(slot.startMinute, span.startMinute);
  const to = Math.min(slot.endMinute, span.endMinute);
  if (to <= from) return 0;
  return uncoveredMinutes(
    atMinute(date, from, timeZone).getTime(),
    atMinute(date, to, timeZone).getTime(),
    member.timeOff,
  );
}

/** Work already placed: a job (or a held checkout) in the window starting at `startsAt`. */
export type PlacedWork = { startsAt: Date; workMinutes: number };

export type PlannedSlot = WindowSlot & {
  index: number;
  capacityMinutes: number;
  freeMinutes: number;
};

/**
 * Takes `work` minutes starting in window `start`: up to one window's length from each
 * window in turn. With `strict`, fails (and changes nothing) unless every part fits; without
 * it, takes whatever is left, so existing work never makes the plan inconsistent.
 */
function take(slots: PlannedSlot[], start: number, work: number, strict: boolean): boolean {
  const free = slots.map((slot) => slot.freeMinutes);
  let remaining = work;
  for (let index = start; index < slots.length && remaining > 0; index += 1) {
    const slot = slots[index] as PlannedSlot;
    const want = Math.min(remaining, slot.endMinute - slot.startMinute);
    const taken = Math.min(want, free[index] ?? 0);
    if (strict && taken < want) return false;
    free[index] = (free[index] ?? 0) - taken;
    remaining -= want;
  }
  if (strict && remaining > 0) return false;
  slots.forEach((slot, index) => {
    slot.freeMinutes = free[index] ?? 0;
  });
  return true;
}

/** The window a piece of work belongs to: the one it starts in, or the latest before it. */
function slotIndexFor(slots: readonly PlannedSlot[], at: Date): number {
  let found = -1;
  slots.forEach((slot, index) => {
    if (slot.startsAt.getTime() <= at.getTime()) found = index;
  });
  return found;
}

/** Capacity and what's left of each window on `date`. */
export function planDay(input: {
  date: CalendarDate;
  windows: readonly ArrivalWindow[];
  members: readonly MemberAvailability[];
  placed: readonly PlacedWork[];
  timeZone?: string;
}): PlannedSlot[] {
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  const slots: PlannedSlot[] = windowSlotsForDate(input.date, input.windows, timeZone).map(
    (slot, index) => {
      const capacityMinutes = input.members.reduce(
        (sum, member) => sum + memberMinutesInSlot(slot, member, timeZone),
        0,
      );
      return { ...slot, index, capacityMinutes, freeMinutes: capacityMinutes };
    },
  );
  const first = slots[0];
  const last = slots.at(-1);
  if (!first || !last) return slots;
  const dayStart = first.startsAt.getTime();
  const dayEnd = last.endsAt.getTime();
  const placed = input.placed
    .filter((work) => work.startsAt.getTime() >= dayStart && work.startsAt.getTime() < dayEnd)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (const work of placed) {
    const index = slotIndexFor(slots, work.startsAt);
    if (index >= 0) take(slots, index, work.workMinutes, false);
  }
  return slots;
}

/** Whether a job of `workMinutes` fits if it starts in window `index` of `plan`. */
export function fitsInWindow(
  plan: readonly PlannedSlot[],
  index: number,
  workMinutes: number,
): boolean {
  if (index < 0 || index >= plan.length || workMinutes <= 0) return false;
  const copy = plan.map((slot) => ({ ...slot }));
  return take(copy, index, workMinutes, true);
}

export type BookingWindowRules = {
  minNoticeDays: number;
  maxDaysAhead: number;
};

/** First and last bookable local dates, and the earliest bookable instant. */
export function bookableRange(
  now: Date,
  rules: BookingWindowRules,
  timeZone: string = DEFAULT_TIME_ZONE,
): { first: CalendarDate; last: CalendarDate; earliest: Date } {
  const local = toLocal(now, timeZone);
  const today = { year: local.year, month: local.month, day: local.day };
  const first = addCalendarDays(today, rules.minNoticeDays);
  const earliest =
    rules.minNoticeDays === 0
      ? new Date(now.getTime() + BOOKING_NOTICE_LIMITS.sameDayLeadMinutes * MS_PER_MINUTE)
      : atMinute(first, 0, timeZone);
  return { first, last: addCalendarDays(today, rules.maxDaysAhead), earliest };
}

function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

export type DayAvailability = {
  date: string;
  weekday: number;
  windows: Array<ArrivalWindow & { startsAt: Date; endsAt: Date; available: boolean }>;
};

/**
 * Which windows a job of `workMinutes` can be booked in, for up to `days` days from
 * `from` (default: the first bookable day), within the business's notice rules.
 */
export function availableDays(input: {
  now: Date;
  rules: BookingWindowRules;
  windows: readonly ArrivalWindow[];
  members: readonly MemberAvailability[];
  placed: readonly PlacedWork[];
  workMinutes: number;
  from?: CalendarDate;
  days: number;
  timeZone?: string;
}): DayAvailability[] {
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  const range = bookableRange(input.now, input.rules, timeZone);
  const start = input.from && compareDates(input.from, range.first) > 0 ? input.from : range.first;
  const result: DayAvailability[] = [];
  for (let offset = 0; offset < input.days; offset += 1) {
    const date = addCalendarDays(start, offset);
    if (compareDates(date, range.last) > 0) break;
    const plan = planDay({
      date,
      windows: input.windows,
      members: input.members,
      placed: input.placed,
      timeZone,
    });
    result.push({
      date: formatIsoDate(date),
      weekday: weekdayOf(date),
      windows: plan.map((slot) => ({
        startMinute: slot.startMinute,
        endMinute: slot.endMinute,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        available:
          slot.startsAt.getTime() >= range.earliest.getTime() &&
          fitsInWindow(plan, slot.index, input.workMinutes),
      })),
    });
  }
  return result;
}

export type WindowCheck =
  | { ok: true; slot: PlannedSlot }
  | { ok: false; reason: "no_window" | "too_soon" | "too_far" | "full" };

/** Server-side check of a requested day and window before taking payment. */
export function checkWindow(input: {
  now: Date;
  rules: BookingWindowRules;
  windows: readonly ArrivalWindow[];
  members: readonly MemberAvailability[];
  placed: readonly PlacedWork[];
  workMinutes: number;
  date: CalendarDate;
  startMinute: number;
  timeZone?: string;
}): WindowCheck {
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  const range = bookableRange(input.now, input.rules, timeZone);
  if (compareDates(input.date, range.last) > 0) return { ok: false, reason: "too_far" };
  const plan = planDay({ ...input, timeZone });
  const slot = plan.find((candidate) => candidate.startMinute === input.startMinute);
  if (!slot) return { ok: false, reason: "no_window" };
  if (
    compareDates(input.date, range.first) < 0 ||
    slot.startsAt.getTime() < range.earliest.getTime()
  ) {
    return { ok: false, reason: "too_soon" };
  }
  if (!fitsInWindow(plan, slot.index, input.workMinutes)) return { ok: false, reason: "full" };
  return { ok: true, slot };
}

/** When a business must have finished payout setup, counted from its first paid booking. */
export function payoutSetupDueAt(firstPaidBookingAt: Date): Date {
  return new Date(firstPaidBookingAt.getTime() + PAYOUT_SETUP_DAYS * MS_PER_DAY);
}

/** New bookings are paused once the payout-setup deadline has passed unfinished. */
export function canTakeBookings(input: {
  payoutsEnabled: boolean;
  payoutSetupDueAt: Date | null;
  now: Date;
}): boolean {
  return (
    input.payoutsEnabled ||
    input.payoutSetupDueAt === null ||
    input.now.getTime() < input.payoutSetupDueAt.getTime()
  );
}

const isoDateSchema = z.string().refine((value) => parseIsoDate(value) !== null, {
  message: "Pick a day",
});

const addressLine = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, { message: `Enter the ${label}` })
    .max(max)
    .regex(/^[^\p{Cc}]+$/u, { message: `The ${label} can't contain control characters` });

/** Where the job is (Nova Scotia only, SPEC §2). */
export const jobAddressSchema = z.object({
  line1: addressLine("street address", 120),
  line2: z
    .string()
    .trim()
    .max(120)
    .regex(/^[^\p{Cc}]*$/u)
    .transform((value) => value || null),
  city: addressLine("town or city", 80),
  postalCode: launchPostalCodeSchema,
});
export type JobAddressInput = z.input<typeof jobAddressSchema>;

/** A customer's booking request from the website (SPEC §19). */
export const bookingRequestSchema = z.object({
  serviceId: z.uuid(),
  date: isoDateSchema,
  /** Start of the chosen arrival window, in minutes from local midnight. */
  windowStart: z.number().int().min(0).max(1439),
  address: jobAddressSchema,
  notes: z
    .string()
    .trim()
    .max(CUSTOMER_NOTES_MAX_LENGTH)
    .refine((text) => !hasDisallowedControlCharacters(text), {
      message: "Notes can't contain control characters",
    })
    .transform((value) => value || null),
});
export type BookingRequestInput = z.input<typeof bookingRequestSchema>;
