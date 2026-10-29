/**
 * Recurring jobs and snow contracts — SPEC §21. Pure rules: how far a series can run,
 * how a season splits into months and prices, when each charge is due and retried, when
 * the business is paid a month's share, and what's refunded when a contract ends.
 */
import { z } from "zod";

import {
  CANCELLATION_POLICIES,
  type CancellationPolicyId,
  freeCancellationDeadline,
  type PaidAmounts,
  type RefundBreakdown,
} from "./cancellation.ts";
import { BUSINESS_FEE_BPS } from "./fees.ts";
import { assertCents, bigintToCents, type Cents, divideRoundHalfUp, percentOf } from "./money.ts";
import {
  FREQUENCY_LABELS,
  RECURRENCE_FREQUENCIES,
  type RecurrenceFrequency,
} from "./recurrence.ts";
import { jobAddressSchema } from "./scheduling.ts";
import {
  addCalendarDays,
  assertValidDate,
  type CalendarDate,
  DEFAULT_TIME_ZONE,
  daysInMonth,
  formatIsoDate,
  fromLocal,
  MS_PER_DAY,
  MS_PER_HOUR,
  parseIsoDate,
  toLocal,
} from "./time.ts";

export const SERIES_LIMITS = {
  /** The last visit is at most this many months after the first. */
  maxMonths: 6,
  /** Dates the customer can skip or move to another window when sending the request. */
  maxOverrides: 30,
} as const;

export const SNOW_CONTRACT_LIMITS = {
  minTriggerCm: 1,
  maxTriggerCm: 50,
  /** A season covers at most this many calendar months. */
  maxSeasonMonths: 7,
  minSpots: 1,
  maxSpots: 500,
  minPriceCents: 500,
  maxPriceCents: 2_000_000,
} as const;

/** How a failed charge on a saved card is retried (SPEC §21). */
export const CHARGE_RETRY = {
  /** Retries after the first failure, one per interval. */
  retries: 3,
  intervalHours: 24,
  /** A recurring visit still unpaid this long before it starts is cancelled. */
  recurringDeadlineHours: 24,
} as const;

/** Customers are reminded of a recurring visit at this local hour the day before. */
export const VISIT_REMINDER_LOCAL_HOUR = 17;
/** Later season instalments are charged at this local hour on the 1st of the month. */
export const INSTALMENT_LOCAL_HOUR = 9;

export const CONTRACT_PRICINGS = ["per_visit", "season"] as const;
export type ContractPricing = (typeof CONTRACT_PRICINGS)[number];
export const SEASON_BILLINGS = ["upfront", "monthly", "either"] as const;
export type SeasonBilling = (typeof SEASON_BILLINGS)[number];
/** What the customer pays a season price with. */
export type SeasonPayment = Exclude<SeasonBilling, "either">;

const isoDate = z.string().refine((value) => parseIsoDate(value) !== null, {
  message: "Pick a date",
});

function compareDates(a: CalendarDate, b: CalendarDate): number {
  return formatIsoDate(a).localeCompare(formatIsoDate(b));
}

/** Calendar months from `start` to `end` inclusive (Nov 15 – Mar 31 → 5). */
export function monthsSpanned(start: CalendarDate, end: CalendarDate): number {
  return (end.year - start.year) * 12 + (end.month - start.month) + 1;
}

/** The same day `months` months later, clamped to the end of shorter months. */
export function addCalendarMonths(date: CalendarDate, months: number): CalendarDate {
  const index = date.month - 1 + months;
  const year = date.year + Math.floor(index / 12);
  const month = (((index % 12) + 12) % 12) + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/** The last date a series starting on `first` may run to. */
export function seriesLastAllowedDate(first: CalendarDate): CalendarDate {
  return addCalendarMonths(first, SERIES_LIMITS.maxMonths);
}

// ---------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------

/** The schedule of a recurring booking: frequency, first visit, end, changes. */
const scheduleShape = {
  frequency: z.enum(RECURRENCE_FREQUENCIES),
  /** First visit's date and arrival window. */
  date: isoDate,
  windowStart: z.number().int().min(0).max(1439),
  /** Last day the series may run (inclusive). */
  endDate: isoDate,
  /** Full dates the customer skips (null) or moves to another window that day. */
  overrides: z
    .array(z.object({ date: isoDate, windowStart: z.number().int().min(0).max(1439).nullable() }))
    .max(SERIES_LIMITS.maxOverrides)
    .default([]),
};

function checkSchedule(
  input: { date: string; endDate: string; overrides: Array<{ date: string }> },
  ctx: z.RefinementCtx,
): void {
  const first = parseIsoDate(input.date);
  const last = parseIsoDate(input.endDate);
  if (!first || !last) return;
  if (compareDates(last, first) <= 0) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "End after the first visit" });
  } else if (compareDates(last, seriesLastAllowedDate(first)) > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: `A series can run up to ${SERIES_LIMITS.maxMonths} months`,
    });
  }
  const seen = new Set<string>();
  for (const override of input.overrides) {
    if (seen.has(override.date)) {
      ctx.addIssue({ code: "custom", path: ["overrides"], message: "One change per date" });
      return;
    }
    seen.add(override.date);
  }
}

const recurringScheduleShape = { serviceId: z.uuid(), ...scheduleShape };
const quotedScheduleShape = { quoteId: z.uuid(), ...scheduleShape };
const jobDetailsShape = {
  address: jobAddressSchema,
  notes: z
    .string()
    .trim()
    .max(500)
    .transform((value) => value || null),
};

/** A recurring schedule on its own, for previews before the address is entered. */
export const recurringScheduleSchema = z.object(recurringScheduleShape).superRefine(checkSchedule);
export type RecurringScheduleInput = z.input<typeof recurringScheduleSchema>;

/** A customer's recurring booking request (SPEC §21). */
export const recurringRequestSchema = z
  .object({ ...recurringScheduleShape, ...jobDetailsShape })
  .superRefine(checkSchedule);

/** The same, for a pro's recurring offer in a quote (SPEC §21). */
export const quotedScheduleSchema = z.object(quotedScheduleShape).superRefine(checkSchedule);
export const quotedRecurringRequestSchema = z
  .object({ ...quotedScheduleShape, ...jobDetailsShape })
  .superRefine(checkSchedule);
export type RecurringRequestInput = z.input<typeof recurringRequestSchema>;

/** A snow contract's terms, as a business lists them or offers them in a quote. */
export const snowContractTermsSchema = z
  .object({
    triggerCm: z
      .number()
      .int()
      .min(SNOW_CONTRACT_LIMITS.minTriggerCm)
      .max(SNOW_CONTRACT_LIMITS.maxTriggerCm, { message: "Up to 50 cm" }),
    seasonStart: isoDate,
    seasonEnd: isoDate,
    pricing: z.enum(CONTRACT_PRICINGS),
    priceCents: z
      .number({ message: "Enter the price" })
      .int()
      .min(SNOW_CONTRACT_LIMITS.minPriceCents, { message: "At least $5" })
      .max(SNOW_CONTRACT_LIMITS.maxPriceCents, { message: "At most $20,000" }),
    /** How a season price is paid; null for per-visit pricing. */
    seasonBilling: z.enum(SEASON_BILLINGS).nullable(),
  })
  .superRefine((terms, ctx) => {
    const start = parseIsoDate(terms.seasonStart);
    const end = parseIsoDate(terms.seasonEnd);
    if (start && end) {
      if (compareDates(end, start) <= 0) {
        ctx.addIssue({ code: "custom", path: ["seasonEnd"], message: "End after the start" });
      } else if (monthsSpanned(start, end) > SNOW_CONTRACT_LIMITS.maxSeasonMonths) {
        ctx.addIssue({
          code: "custom",
          path: ["seasonEnd"],
          message: `A season covers at most ${SNOW_CONTRACT_LIMITS.maxSeasonMonths} months`,
        });
      }
    }
    if (terms.pricing === "season" && terms.seasonBilling === null) {
      ctx.addIssue({
        code: "custom",
        path: ["seasonBilling"],
        message: "Choose how the season price is paid",
      });
    }
    if (terms.pricing === "per_visit" && terms.seasonBilling !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["seasonBilling"],
        message: "Only a season price has a payment plan",
      });
    }
  });
export type SnowContractTerms = z.output<typeof snowContractTermsSchema>;

/** A listed snow contract: the terms plus how many customers it can take. */
export const snowContractListingSchema = snowContractTermsSchema.and(
  z.object({
    spots: z
      .number()
      .int()
      .min(SNOW_CONTRACT_LIMITS.minSpots)
      .max(SNOW_CONTRACT_LIMITS.maxSpots, { message: "Up to 500 spots" }),
  }),
);

const signupShape = {
  ...jobDetailsShape,
  /** Required when the contract's season price can be paid either way. */
  seasonPayment: z.enum(["upfront", "monthly"]).nullable().default(null),
  agreed: z.literal(true, { message: "Read and agree to the terms" }),
};

/** A customer signing up for a listed snow contract (SPEC §21). */
export const snowSignupSchema = z.object({ serviceId: z.uuid(), ...signupShape });

/** A customer signing up for snow contract terms a pro sent in a quote (SPEC §21). */
export const quotedSnowSignupSchema = z.object({ quoteId: z.uuid(), ...signupShape });

/** Which payment plan a customer ends up on for a season price. */
export function seasonPaymentFor(
  billing: SeasonBilling,
  chosen: SeasonPayment | null,
): SeasonPayment | null {
  if (billing === "either") return chosen;
  return billing;
}

// ---------------------------------------------------------------------------------------
// Season months and prices
// ---------------------------------------------------------------------------------------

export type SeasonPeriod = {
  sequence: number;
  /** First and last day of the period (YYYY-MM-DD, inclusive). */
  start: string;
  end: string;
  days: number;
};

/** The season's calendar months, clipped to its first and last day (SPEC §21). */
export function seasonPeriods(seasonStart: string, seasonEnd: string): SeasonPeriod[] {
  const start = parseIsoDate(seasonStart);
  const end = parseIsoDate(seasonEnd);
  if (!start || !end) throw new RangeError("season dates must be YYYY-MM-DD");
  if (compareDates(end, start) <= 0) throw new RangeError("season must end after it starts");
  const count = monthsSpanned(start, end);
  return Array.from({ length: count }, (_, index) => {
    const monthStart = addCalendarMonths({ year: start.year, month: start.month, day: 1 }, index);
    const first = index === 0 ? start : monthStart;
    const monthEnd = { ...monthStart, day: daysInMonth(monthStart.year, monthStart.month) };
    const last = index === count - 1 ? end : monthEnd;
    return {
      sequence: index + 1,
      start: formatIsoDate(first),
      end: formatIsoDate(last),
      days: daysBetween(first, last) + 1,
    };
  });
}

function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) /
      MS_PER_DAY,
  );
}

/** Splits an amount into `parts` near-equal cents, leftover cents to the first parts. */
export function splitEvenly(totalCents: Cents, parts: number): Cents[] {
  assertCents(totalCents, "totalCents");
  if (!Number.isInteger(parts) || parts < 1)
    throw new RangeError("parts must be a positive integer");
  const base = Math.floor(totalCents / parts);
  const leftover = totalCents - base * parts;
  return Array.from({ length: parts }, (_, index) => base + (index < leftover ? 1 : 0));
}

/**
 * When a season instalment is charged. Upfront: everything when the contract is
 * accepted. Monthly: the first month at acceptance, each later one at 9 am on its first
 * day (never before acceptance).
 */
export function instalmentChargeAt(input: {
  payment: SeasonPayment;
  period: Pick<SeasonPeriod, "sequence" | "start">;
  acceptedAt: Date;
  timeZone?: string;
}): Date {
  assertValidDate(input.acceptedAt, "acceptedAt");
  if (input.payment === "upfront" || input.period.sequence === 1) {
    return new Date(input.acceptedAt.getTime());
  }
  const start = parseIsoDate(input.period.start);
  if (!start) throw new RangeError("period start must be YYYY-MM-DD");
  const due = fromLocal(
    { ...start, hour: INSTALMENT_LOCAL_HOUR },
    input.timeZone ?? DEFAULT_TIME_ZONE,
  );
  return due.getTime() < input.acceptedAt.getTime() ? new Date(input.acceptedAt.getTime()) : due;
}

/** When a month's share is released to the business: once the month is over. */
export function periodReleaseAt(periodEnd: string, timeZone: string = DEFAULT_TIME_ZONE): Date {
  const end = parseIsoDate(periodEnd);
  if (!end) throw new RangeError("period end must be YYYY-MM-DD");
  return fromLocal(addCalendarDays(end, 1), timeZone);
}

// ---------------------------------------------------------------------------------------
// Charges on a saved card
// ---------------------------------------------------------------------------------------

/**
 * When to try a failed charge again: daily after the first failure, up to
 * `CHARGE_RETRY.retries` times; null once they're used up.
 */
export function nextChargeRetryAt(firstFailedAt: Date, failures: number): Date | null {
  assertValidDate(firstFailedAt, "firstFailedAt");
  if (!Number.isInteger(failures) || failures < 1) throw new RangeError("failures must be ≥ 1");
  if (failures > CHARGE_RETRY.retries) return null;
  return new Date(firstFailedAt.getTime() + failures * CHARGE_RETRY.intervalHours * MS_PER_HOUR);
}

/** A recurring visit still unpaid at this instant is cancelled and its series paused. */
export function recurringPaymentDeadline(visitStartsAt: Date): Date {
  assertValidDate(visitStartsAt, "visitStartsAt");
  return new Date(visitStartsAt.getTime() - CHARGE_RETRY.recurringDeadlineHours * MS_PER_HOUR);
}

/** When to remind the customer of a recurring visit: 5 pm local the day before. */
export function visitReminderAt(visitStartsAt: Date, timeZone: string = DEFAULT_TIME_ZONE): Date {
  assertValidDate(visitStartsAt, "visitStartsAt");
  const local = toLocal(visitStartsAt, timeZone);
  const dayBefore = addCalendarDays({ year: local.year, month: local.month, day: local.day }, -1);
  return fromLocal({ ...dayBefore, hour: VISIT_REMINDER_LOCAL_HOUR }, timeZone);
}

/**
 * What a customer pays to skip a recurring visit that hasn't been charged yet: nothing
 * inside the policy's free window, otherwise the part the policy keeps (the kept share of
 * the price and its tax, plus the service fee), as if the visit had been paid and then
 * cancelled (SPEC §5, §21).
 */
export function lateSkipCharge(input: {
  policy: CancellationPolicyId;
  visitStartsAt: Date;
  skippedAt: Date;
  timeZone?: string;
  amounts: PaidAmounts;
}): PaidAmounts | null {
  assertValidDate(input.skippedAt, "skippedAt");
  const deadline = freeCancellationDeadline(input.policy, input.visitStartsAt, input.timeZone);
  if (input.skippedAt.getTime() <= deadline.getTime()) return null;
  const keptBps = 10_000 - CANCELLATION_POLICIES[input.policy].lateRefundBps;
  const priceCents = percentOf(input.amounts.priceCents, keptBps);
  return {
    priceCents,
    taxOnPriceCents: share(input.amounts.taxOnPriceCents, priceCents, input.amounts.priceCents),
    serviceFeeCents: input.amounts.serviceFeeCents,
    taxOnFeeCents: input.amounts.taxOnFeeCents,
  };
}

/** `amount × part / whole`, rounded half up to the cent. */
function share(amount: Cents, part: number, whole: number): Cents {
  if (whole === 0 || part === 0) return 0;
  if (part === whole) return amount;
  return bigintToCents(divideRoundHalfUp(BigInt(amount) * BigInt(part), BigInt(whole)));
}

/** A refund of `numerator / denominator` of everything paid, service fee included. */
function proportionalRefund(
  paid: PaidAmounts,
  numerator: number,
  denominator: number,
): RefundBreakdown {
  const priceRefundCents = share(paid.priceCents, numerator, denominator);
  const taxOnPriceRefundCents = share(paid.taxOnPriceCents, numerator, denominator);
  const serviceFeeRefundCents = share(paid.serviceFeeCents, numerator, denominator);
  const taxOnFeeRefundCents = share(paid.taxOnFeeCents, numerator, denominator);
  const retainedPriceCents = paid.priceCents - priceRefundCents;
  const businessFeeCents = percentOf(retainedPriceCents, BUSINESS_FEE_BPS);
  return {
    priceRefundBps:
      paid.priceCents === 0 ? 0 : Math.round((priceRefundCents * 10_000) / paid.priceCents),
    isFreeCancellation: numerator >= denominator,
    priceRefundCents,
    taxOnPriceRefundCents,
    serviceFeeRefundCents,
    taxOnFeeRefundCents,
    totalRefundCents:
      priceRefundCents + taxOnPriceRefundCents + serviceFeeRefundCents + taxOnFeeRefundCents,
    retainedPriceCents,
    businessFeeCents,
    businessPayoutCents: retainedPriceCents - businessFeeCents,
    retainedTaxOnPriceCents: paid.taxOnPriceCents - taxOnPriceRefundCents,
  };
}

export type SeasonPeriodState = Pick<SeasonPeriod, "sequence" | "start" | "end" | "days"> & {
  /** What was collected for this month, or null if it hasn't been charged. */
  paid: PaidAmounts | null;
};

export type SeasonEndAction =
  /** A month already over, or the customer's current month: the business keeps it. */
  | { sequence: number; action: "keep" }
  /** Not charged and no longer owed: drop the scheduled charge. */
  | { sequence: number; action: "cancel_charge" }
  /** Still owed though not yet collected (the customer's current month). */
  | { sequence: number; action: "still_due" }
  /** Refund (all of a later month paid upfront, or the rest of the current month). */
  | { sequence: number; action: "refund"; refund: RefundBreakdown };

/**
 * What happens to each month of a season-priced contract when it ends early (SPEC §21).
 * The customer keeps paying for the current month; the business refunds the rest of it
 * day by day. Later months are never owed: refunded in full if paid upfront.
 */
export function seasonEndActions(input: {
  by: "customer" | "business";
  /** The local date the contract ends (YYYY-MM-DD). */
  endedOn: string;
  periods: readonly SeasonPeriodState[];
}): SeasonEndAction[] {
  if (!parseIsoDate(input.endedOn)) throw new RangeError("endedOn must be YYYY-MM-DD");
  return input.periods.map((period): SeasonEndAction => {
    const { sequence, paid } = period;
    if (period.end < input.endedOn)
      return paid ? { sequence, action: "keep" } : { sequence, action: "still_due" };
    if (period.start > input.endedOn) {
      return paid
        ? { sequence, action: "refund", refund: proportionalRefund(paid, 1, 1) }
        : { sequence, action: "cancel_charge" };
    }
    // The current month.
    if (input.by === "customer")
      return paid ? { sequence, action: "keep" } : { sequence, action: "still_due" };
    if (!paid) return { sequence, action: "cancel_charge" };
    const start = parseIsoDate(period.start) as CalendarDate;
    const endedOn = parseIsoDate(input.endedOn) as CalendarDate;
    const used = daysBetween(start, endedOn);
    if (used === 0) return { sequence, action: "refund", refund: proportionalRefund(paid, 1, 1) };
    return {
      sequence,
      action: "refund",
      refund: proportionalRefund(paid, period.days - used, period.days),
    };
  });
}

/** "Every week" style summary plus the visit count, for previews. */
export function seriesSummary(frequency: RecurrenceFrequency, visits: number): string {
  return `${FREQUENCY_LABELS[frequency]} · ${visits} ${visits === 1 ? "visit" : "visits"}`;
}
