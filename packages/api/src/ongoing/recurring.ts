/**
 * Recurring jobs (SPEC §21). A series is planned against the business's capacity, sent as
 * a request the business accepts within 24 hours, then placed on the calendar as visits
 * charged 3 days before each. Afterwards the customer can skip a visit or end the series;
 * the business can move or cancel a visit or end the series.
 */
import type { EmailMessage } from "@nevile/auth";
import {
  APPROVAL_EXPIRY_HOURS,
  type ArrivalWindow,
  addCalendarDays,
  availableDays,
  type BookingWindowRules,
  bookableRange,
  type CalendarDate,
  calculateCharge,
  chargeAtFor,
  checkWindow,
  FREQUENCY_LABELS,
  formatArrivalWindow,
  formatIsoDate,
  formatMinuteOfDay,
  fromLocal,
  lateSkipCharge,
  MS_PER_DAY,
  MS_PER_HOUR,
  occurrenceDates,
  parseIsoDate,
  type RecurrenceFrequency,
  type recurringRequestSchema,
  refundForBusinessCancellation,
  seriesSummary,
  toLocal,
  visitReminderAt,
} from "@nevile/core";
import {
  addresses,
  and,
  asc,
  type Booking,
  type Business,
  bookings,
  businesses,
  type DbExecutor,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  type RecurringOverride,
  type RecurringSeries,
  recurringOverrides,
  recurringSeries,
  type Visit,
  visits,
} from "@nevile/db";
import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import { businessTeamEmails, customerEmail, whenLabel } from "../bookings/emails.ts";
import {
  assertCanBook,
  assertTransition,
  audit,
  type BookingDeps,
  type BookingParts,
  bookableService,
  cancelByCustomer,
  customerCancellationQuote,
  loadBookingParts,
  lockedParts,
  pushNotifications,
  recordRefund,
  startPayoutClock,
  WINDOW_MESSAGES,
} from "../bookings/flows.ts";
import { loadSchedule, lockBusinessCapacity, noticeRules } from "../bookings/schedule.ts";
import { firstName } from "../bookings/views.ts";
import { savedCardOf } from "../cards/flows.ts";
import { openConversation } from "../chat/flows.ts";
import { businessTeamUserIds, NOTIFICATION_TYPES, notify } from "../inbox.ts";
import { sendAll } from "../notify.ts";
import { API_ERROR_REASONS, reasonError } from "../trpc.ts";
import { type Amounts, chargeOngoing, chargeTarget } from "./charges.ts";
import { type SeriesMailFacts, seriesEmails } from "./emails.ts";

type Mail = EmailMessage[];

/** Most visits one series can have (6 months of weekly visits is 27). */
const MAX_SERIES_VISITS = 40;
/** Later visits may be further ahead than the business's booking horizon (SPEC §21). */
const SERIES_HORIZON_DAYS = 400;

export type SeriesInput = z.output<typeof recurringRequestSchema>;

/** What the customer chose: schedule, window, and dates skipped or moved to another window. */
export type SeriesChoice = {
  frequency: RecurrenceFrequency;
  firstDate: CalendarDate;
  endDate: CalendarDate;
  windowStart: number;
  /** ISO date → another window that day, or null to skip the date. */
  overrides: ReadonlyMap<string, number | null>;
  workMinutes: number;
};

type DateProblem = "full" | "no_window" | "too_soon" | "too_far";

/** One date of a series, checked against the calendar. */
export type PlannedDate = {
  date: string;
  /** The window asked for; null when the customer skips the date. */
  windowStart: number | null;
  status: "ok" | "skipped" | DateProblem;
  slot: { startsAt: Date; endsAt: Date } | null;
  /** Other windows with room that day, for a date that doesn't fit. */
  alternatives: number[];
};

const placedDates = (dates: PlannedDate[]) =>
  dates.flatMap((date) =>
    date.status === "ok" && date.slot ? [{ ...date, slot: date.slot }] : [],
  );

function daysFrom(from: CalendarDate, to: CalendarDate): number {
  return Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) /
      MS_PER_DAY,
  );
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  weekday: "long",
  month: "long",
  day: "numeric",
});

/** "Tuesday, November 3" for an ISO date. */
export function dateLabel(iso: string): string {
  const date = parseIsoDate(iso);
  return date ? DATE_FORMAT.format(Date.UTC(date.year, date.month - 1, date.day)) : iso;
}

/** The local ISO date an instant falls on. */
export function localIsoDate(at: Date, timeZone: string): string {
  const local = toLocal(at, timeZone);
  return formatIsoDate({ year: local.year, month: local.month, day: local.day });
}

/** Arrival window labels by start minute ("8–11 am"). */
export function windowLabeler(windows: readonly ArrivalWindow[]) {
  return (startMinute: number) => {
    const window = windows.find((candidate) => candidate.startMinute === startMinute);
    return window ? formatArrivalWindow(window) : formatMinuteOfDay(startMinute);
  };
}

/**
 * Checks every date of a series against the calendar. Requests use the business's notice
 * rules for the first visit; acceptance only needs each visit to still be ahead.
 */
export async function planSeries(
  db: DbExecutor,
  business: Business,
  choice: SeriesChoice,
  now: Date,
  mode: "request" | "accept",
): Promise<{ dates: PlannedDate[]; windows: ArrivalWindow[] }> {
  const dates = occurrenceDates(
    choice.frequency,
    choice.firstDate,
    choice.endDate,
    MAX_SERIES_VISITS,
  );
  const last = dates.at(-1) ?? choice.firstDate;
  const schedule = await loadSchedule(
    db,
    business,
    choice.firstDate,
    daysFrom(choice.firstDate, last) + 1,
    now,
  );
  const later: BookingWindowRules = {
    minNoticeDays: mode === "accept" ? 0 : business.minNoticeDays,
    maxDaysAhead: SERIES_HORIZON_DAYS,
  };
  const planned = dates.map((date, index): PlannedDate => {
    const iso = formatIsoDate(date);
    const override = choice.overrides.get(iso);
    if (override === null) {
      return { date: iso, windowStart: null, status: "skipped", slot: null, alternatives: [] };
    }
    const rules = mode === "request" && index === 0 ? noticeRules(business) : later;
    const check = (startMinute: number) =>
      checkWindow({
        now,
        rules,
        windows: schedule.windows,
        members: schedule.members,
        placed: schedule.placed,
        workMinutes: choice.workMinutes,
        date,
        startMinute,
        timeZone: business.timezone,
      });
    const windowStart = override ?? choice.windowStart;
    const result = check(windowStart);
    if (result.ok) {
      return {
        date: iso,
        windowStart,
        status: "ok",
        slot: { startsAt: result.slot.startsAt, endsAt: result.slot.endsAt },
        alternatives: [],
      };
    }
    return {
      date: iso,
      windowStart,
      status: result.reason,
      slot: null,
      alternatives: schedule.windows
        .map((window) => window.startMinute)
        .filter((startMinute) => startMinute !== windowStart && check(startMinute).ok),
    };
  });
  return { dates: planned, windows: schedule.windows };
}

/** Why a planned series can't be sent yet, or null when it can. */
export function seriesProblem(
  dates: PlannedDate[],
): { code: "BAD_REQUEST" | "CONFLICT"; message: string } | null {
  const first = dates[0];
  if (!first || first.status === "skipped") {
    return { code: "BAD_REQUEST", message: "Your first visit can't be skipped. Pick another day." };
  }
  if (first.status !== "ok") {
    return { code: "CONFLICT", message: `First visit: ${WINDOW_MESSAGES[first.status]}` };
  }
  const blocked = dates.filter((date) => date.status !== "ok" && date.status !== "skipped");
  if (blocked.length > 0) {
    return {
      code: "CONFLICT",
      message: `${blocked.length === 1 ? "One date is" : `${blocked.length} dates are`} full. Skip ${
        blocked.length === 1 ? "it" : "them"
      } or pick another window that day.`,
    };
  }
  if (placedDates(dates).length < 2) {
    return {
      code: "BAD_REQUEST",
      message: "A recurring booking needs at least 2 visits. Pick a later end date.",
    };
  }
  return null;
}

/** A fixed-price service offered on this schedule, or an error saying why not. */
async function recurringService(db: DbExecutor, serviceId: string, frequency: RecurrenceFrequency) {
  const target = await bookableService(db, serviceId);
  if (!target.service.recurrenceFrequencies.includes(frequency)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `This pro doesn't offer “${FREQUENCY_LABELS[frequency].toLowerCase()}” for this service.`,
    });
  }
  return target;
}

function choiceOf(
  input: Pick<SeriesInput, "frequency" | "date" | "endDate" | "windowStart" | "overrides">,
  workMinutes: number,
): SeriesChoice {
  const firstDate = parseIsoDate(input.date);
  const endDate = parseIsoDate(input.endDate);
  if (!firstDate || !endDate) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a day." });
  return {
    frequency: input.frequency,
    firstDate,
    endDate,
    windowStart: input.windowStart,
    overrides: new Map(input.overrides.map((change) => [change.date, change.windowStart])),
    workMinutes,
  };
}

/** The stored series as the customer chose it (for acceptance). */
function storedChoice(series: RecurringSeries, overrides: RecurringOverride[]): SeriesChoice {
  const firstDate = parseIsoDate(series.firstDate);
  const endDate = parseIsoDate(series.endDate);
  if (!firstDate || !endDate) throw new Error(`series ${series.id} has invalid dates`);
  return {
    frequency: series.frequency,
    firstDate,
    endDate,
    windowStart: series.windowStartMinute,
    overrides: new Map(overrides.map((row) => [row.date, row.windowStartMinute])),
    workMinutes: series.durationMinutes,
  };
}

export async function loadSeries(db: DbExecutor, bookingId: string) {
  const [series] = await db
    .select()
    .from(recurringSeries)
    .where(eq(recurringSeries.bookingId, bookingId));
  if (!series) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
  const overrides = await db
    .select()
    .from(recurringOverrides)
    .where(eq(recurringOverrides.seriesId, series.id))
    .orderBy(asc(recurringOverrides.date));
  return { series, overrides };
}

/** "Every week from Tuesday, November 3 · 8–11 am until Tuesday, April 27". */
export function scheduleLabel(booking: Booking, series: RecurringSeries): string {
  const first =
    booking.requestedStartsAt && booking.requestedEndsAt
      ? whenLabel(booking.requestedStartsAt, booking.requestedEndsAt, booking.timezone)
      : dateLabel(series.firstDate);
  return `${FREQUENCY_LABELS[series.frequency]} from ${first} until ${dateLabel(series.endDate)}`;
}

function seriesFacts(
  booking: Booking,
  business: Pick<Business, "id" | "name">,
  series: RecurringSeries,
  siteUrl: string,
): SeriesMailFacts {
  return {
    bookingId: booking.id,
    businessId: business.id,
    businessName: business.name,
    serviceTitle: booking.title,
    schedule: scheduleLabel(booking, series),
    perVisitCents: booking.totalCents,
    siteUrl,
  };
}

const seriesPath = (booking: Pick<Booking, "id" | "businessId">) =>
  `/business/bookings/${booking.id}?b=${booking.businessId}`;

// ---------------------------------------------------------------------------------------
// Preview and request
// ---------------------------------------------------------------------------------------

/** Every date of a proposed series with what fits, the price per visit and the total. */
export async function previewSeries(
  deps: Pick<BookingDeps, "db" | "now">,
  input: Pick<
    SeriesInput,
    "serviceId" | "frequency" | "date" | "endDate" | "windowStart" | "overrides"
  >,
) {
  const now = deps.now();
  const { service, business, priceCents } = await recurringService(
    deps.db,
    input.serviceId,
    input.frequency,
  );
  const { dates, windows } = await planSeries(
    deps.db,
    business,
    choiceOf(input, service.durationMinutes),
    now,
    "request",
  );
  const charge = calculateCharge({
    priceCents,
    province: business.province,
    businessTaxRegistered: business.taxRegistered,
    at: now,
  });
  const label = windowLabeler(windows);
  const count = placedDates(dates).length;
  return {
    summary: seriesSummary(input.frequency, count),
    visits: count,
    dates: dates.map((date) => ({
      date: date.date,
      label: dateLabel(date.date),
      windowStart: date.windowStart,
      windowLabel: date.windowStart === null ? null : label(date.windowStart),
      status: date.status,
      alternatives: date.alternatives.map((startMinute) => ({
        startMinute,
        label: label(startMinute),
      })),
    })),
    price: {
      priceCents: charge.priceCents,
      serviceFeeCents: charge.serviceFeeCents,
      taxCents: charge.taxCents,
      totalCents: charge.totalCents,
    },
    totalCents: charge.totalCents * count,
    problem: seriesProblem(dates)?.message ?? null,
  };
}

/**
 * Sends a recurring booking request (SPEC §21): every date checked, nothing charged; the
 * business has 24 hours (or until the first visit) to accept.
 */
export async function requestSeries(
  deps: BookingDeps,
  customer: { id: string; name: string | null },
  input: SeriesInput,
): Promise<{ bookingId: string }> {
  const now = deps.now();
  const { service, business, area, priceCents } = await recurringService(
    deps.db,
    input.serviceId,
    input.frequency,
  );
  await assertCanBook(
    deps.db,
    { business, area, customerId: customer.id, now },
    input.address.postalCode,
  );
  if (!(await savedCardOf(deps.db, customer.id, deps.payments.name))) {
    throw reasonError(
      "PRECONDITION_FAILED",
      "Add a card first: recurring visits are charged to your saved card.",
      API_ERROR_REASONS.CARD_REQUIRED,
    );
  }
  const choice = choiceOf(input, service.durationMinutes);
  const charge = calculateCharge({
    priceCents,
    province: business.province,
    businessTaxRegistered: business.taxRegistered,
    at: now,
  });
  const mail: Mail = [];

  const bookingId = await deps.db.transaction(async (tx) => {
    const [open] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.customerId, customer.id),
          eq(bookings.serviceId, service.id),
          eq(bookings.kind, "recurring"),
          eq(bookings.status, "requested"),
        ),
      )
      .limit(1);
    if (open) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "You've already asked this pro for this. Wait for their answer, or cancel it first.",
      });
    }
    const { dates } = await planSeries(tx, business, choice, now, "request");
    const problem = seriesProblem(dates);
    if (problem) throw new TRPCError(problem);
    const placed = placedDates(dates);
    const first = placed[0]?.slot;
    if (!first) throw new Error("a sendable series has a first visit");

    const [address] = await tx
      .insert(addresses)
      .values({
        userId: customer.id,
        line1: input.address.line1,
        line2: input.address.line2,
        city: input.address.city,
        province: business.province,
        postalCode: input.address.postalCode,
      })
      .returning({ id: addresses.id });
    const [booking] = await tx
      .insert(bookings)
      .values({
        customerId: customer.id,
        businessId: business.id,
        serviceId: service.id,
        addressId: address?.id ?? "",
        title: service.title,
        kind: "recurring",
        status: "requested",
        createdAt: now,
        priceCents: charge.priceCents,
        serviceFeeCents: charge.serviceFeeCents,
        priceTaxCents: charge.taxOnPriceCents,
        feeTaxCents: charge.taxOnFeeCents,
        totalCents: charge.totalCents,
        taxProvince: business.province,
        cancellationPolicy: business.cancellationPolicy,
        timezone: business.timezone,
        requestedStartsAt: first.startsAt,
        requestedEndsAt: first.endsAt,
        customerNotes: input.notes,
        approvalExpiresAt: new Date(
          Math.min(now.getTime() + APPROVAL_EXPIRY_HOURS * MS_PER_HOUR, first.startsAt.getTime()),
        ),
      })
      .returning();
    if (!booking) throw new Error("booking insert returned nothing");
    const [series] = await tx
      .insert(recurringSeries)
      .values({
        bookingId: booking.id,
        frequency: input.frequency,
        startsAt: first.startsAt,
        endsAt: fromLocal(addCalendarDays(choice.endDate, 1), business.timezone),
        durationMinutes: service.durationMinutes,
        firstDate: input.date,
        endDate: input.endDate,
        windowStartMinute: input.windowStart,
      })
      .returning();
    if (!series) throw new Error("series insert returned nothing");
    const changes = dates.filter(
      (date) => date.status === "skipped" || date.windowStart !== input.windowStart,
    );
    if (changes.length > 0) {
      await tx.insert(recurringOverrides).values(
        changes.map((date) => ({
          seriesId: series.id,
          date: date.date,
          windowStartMinute: date.status === "skipped" ? null : date.windowStart,
        })),
      );
    }
    await openConversation(tx, {
      customerId: customer.id,
      businessId: business.id,
      bookingId: booking.id,
    });
    await notify(
      tx,
      await businessTeamUserIds(tx, business.id),
      NOTIFICATION_TYPES.ongoingRequested,
      {
        text: `${firstName(customer.name)} asked for ${service.title}, ${FREQUENCY_LABELS[
          input.frequency
        ].toLowerCase()}`,
        path: seriesPath(booking),
      },
    );
    const facts = seriesFacts(booking, business, series, deps.config.siteUrl);
    mail.push(
      ...seriesEmails.requestedForCustomer(
        await customerEmail(tx, customer.id),
        facts,
        placed.length,
      ),
      ...seriesEmails.requestForBusiness(
        await businessTeamEmails(tx, business.id),
        facts,
        placed.length,
      ),
    );
    return booking.id;
  });
  await sendAll(deps.email, mail);
  await pushNotifications(deps);
  return { bookingId };
}

// ---------------------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------------------

/**
 * The business accepts a recurring request: every date that still fits becomes a visit
 * (charged 3 days before, or now if that's later); dates that stopped fitting are skipped
 * and listed to both sides (SPEC §21).
 */
export async function acceptSeries(
  deps: BookingDeps,
  actorUserId: string,
  businessId: string,
  bookingId: string,
): Promise<{ visits: number; skipped: string[] }> {
  const now = deps.now();
  const mail: Mail = [];
  const outcome = await deps.db.transaction(async (tx) => {
    await lockBusinessCapacity(tx, businessId);
    const parts = await lockedParts(tx, bookingId, businessId);
    const { booking, business } = parts;
    if (booking.kind !== "recurring") throw new Error("not a recurring booking");
    assertTransition(parts, "approve", now);
    const { series, overrides } = await loadSeries(tx, bookingId);
    const { dates } = await planSeries(
      tx,
      business,
      storedChoice(series, overrides),
      now,
      "accept",
    );
    const placed = placedDates(dates);
    const first = placed[0]?.slot;
    const last = placed.at(-1)?.slot;
    if (!first || !last) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "None of these dates fit your calendar any more. Decline, or free up time first.",
      });
    }
    const skipped = dates.filter((date) => date.status !== "ok" && date.status !== "skipped");
    await tx.insert(visits).values(
      placed.map((date, index) => ({
        bookingId,
        businessId,
        assignedMemberId: booking.assignedMemberId,
        sequence: index + 1,
        startsAt: date.slot.startsAt,
        endsAt: date.slot.endsAt,
        workMinutes: series.durationMinutes,
        chargeDueAt: chargeAtFor({
          kind: "recurring_visit",
          visitStartsAt: date.slot.startsAt,
          confirmedAt: now,
          timeZone: booking.timezone,
        }),
      })),
    );
    if (skipped.length > 0) {
      await tx
        .insert(recurringOverrides)
        .values(
          skipped.map((date) => ({
            seriesId: series.id,
            date: date.date,
            windowStartMinute: null,
          })),
        )
        .onConflictDoUpdate({
          target: [recurringOverrides.seriesId, recurringOverrides.date],
          set: { windowStartMinute: null },
        });
    }
    const [updated] = await tx
      .update(bookings)
      .set({
        status: "confirmed",
        confirmedAt: now,
        approvalExpiresAt: null,
        requestedStartsAt: first.startsAt,
        requestedEndsAt: first.endsAt,
      })
      .where(eq(bookings.id, bookingId))
      .returning();
    await tx
      .update(recurringSeries)
      .set({ startsAt: first.startsAt, generatedThrough: last.endsAt })
      .where(eq(recurringSeries.id, series.id));
    await audit(tx, "series.accepted", "booking", bookingId, actorUserId, {
      visits: placed.length,
      skipped: skipped.map((date) => date.date),
    });
    await notify(tx, [booking.customerId], NOTIFICATION_TYPES.ongoingAccepted, {
      text: `${business.name} accepted ${booking.title}`,
      path: `/bookings/${bookingId}`,
    });
    const skippedLabels = skipped.map((date) => dateLabel(date.date));
    mail.push(
      ...seriesEmails.acceptedForCustomer(
        await customerEmail(tx, booking.customerId),
        seriesFacts(updated ?? booking, business, series, deps.config.siteUrl),
        placed.length,
        skippedLabels,
      ),
    );
    await startPayoutClock(tx, business, now);
    return { visits: placed.length, skipped: skippedLabels, customerId: booking.customerId };
  });
  // A first visit less than 3 days away is charged now.
  await chargeOngoing(deps, { customerId: outcome.customerId });
  await sendAll(deps.email, mail);
  await pushNotifications(deps);
  return { visits: outcome.visits, skipped: outcome.skipped };
}

// ---------------------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------------------

const perVisitAmounts = (booking: Booking) => ({
  priceCents: booking.priceCents,
  serviceFeeCents: booking.serviceFeeCents,
  taxOnPriceCents: booking.priceTaxCents,
  taxOnFeeCents: booking.feeTaxCents,
});

/**
 * What skipping a visit now means for the customer: a refund under the policy if it was
 * charged, or the policy's late charge if it wasn't and the free window has passed.
 */
export function skipTerms(
  parts: BookingParts,
  now: Date,
): { refundCents: number; chargeCents: number; late: Amounts | null } {
  const { booking, visit, payment } = parts;
  if (!visit) return { refundCents: 0, chargeCents: 0, late: null };
  if (payment?.status === "succeeded") {
    const refund = customerCancellationQuote(parts, now);
    return { refundCents: refund?.totalRefundCents ?? 0, chargeCents: 0, late: null };
  }
  const kept = lateSkipCharge({
    policy: booking.cancellationPolicy,
    visitStartsAt: visit.startsAt,
    skippedAt: now,
    timeZone: booking.timezone,
    amounts: perVisitAmounts(booking),
  });
  if (!kept) return { refundCents: 0, chargeCents: 0, late: null };
  const late = {
    priceCents: kept.priceCents,
    serviceFeeCents: kept.serviceFeeCents,
    priceTaxCents: kept.taxOnPriceCents,
    feeTaxCents: kept.taxOnFeeCents,
  };
  return {
    refundCents: 0,
    chargeCents: late.priceCents + late.serviceFeeCents + late.priceTaxCents + late.feeTaxCents,
    late,
  };
}

/**
 * Takes one upcoming visit off the calendar: the customer's skip follows the policy, the
 * business's cancellation refunds in full. Returns a late charge to collect after commit.
 */
async function releaseVisit(
  tx: DbExecutor,
  deps: BookingDeps,
  parts: BookingParts,
  by: "customer" | "business",
  actorUserId: string | null,
  now: Date,
): Promise<{ refundCents: number; late: Amounts | null }> {
  const { visit, payment } = parts;
  if (!visit) throw new Error("releaseVisit needs a visit");
  if (payment?.status === "pending") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "A payment for this visit is going through. Try again in a minute.",
    });
  }
  let refundCents = 0;
  let late: Amounts | null = null;
  if (by === "customer") {
    const terms = skipTerms(parts, now);
    late = terms.late;
    const refund = payment?.status === "succeeded" ? customerCancellationQuote(parts, now) : null;
    if (payment && refund) {
      await recordRefund(
        tx,
        deps.payments,
        payment,
        refund,
        "customer_cancellation",
        actorUserId,
        now,
      );
      refundCents = refund.totalRefundCents;
    }
  } else if (payment?.status === "succeeded") {
    const refund = refundForBusinessCancellation({
      priceCents: payment.priceCents,
      serviceFeeCents: payment.serviceFeeCents,
      taxOnPriceCents: payment.priceTaxCents,
      taxOnFeeCents: payment.feeTaxCents,
    });
    await recordRefund(
      tx,
      deps.payments,
      payment,
      refund,
      "business_cancellation",
      actorUserId,
      now,
    );
    refundCents = refund.totalRefundCents;
  }
  await tx
    .update(visits)
    .set({
      status: by === "customer" ? "cancelled_by_customer" : "cancelled_by_business",
      cancelledAt: now,
      chargeDueAt: null,
    })
    .where(eq(visits.id, visit.id));
  return { refundCents, late };
}

/** Collects a late-skip charge (one attempt; a decline isn't retried). Returns cents charged. */
async function collectLateSkip(
  deps: BookingDeps,
  booking: Booking,
  visitId: string,
  late: Amounts | null,
): Promise<number> {
  if (!late) return 0;
  const outcome = await chargeTarget(deps, {
    kind: "visit",
    booking,
    visitId,
    releaseNow: true,
    amounts: late,
    description: `${booking.title}, late skip`,
  });
  if (outcome !== "succeeded") return 0;
  return late.priceCents + late.serviceFeeCents + late.priceTaxCents + late.feeTaxCents;
}

function visitWhen(parts: BookingParts): string {
  const visit = parts.visit;
  return visit ? whenLabel(visit.startsAt, visit.endsAt, parts.booking.timezone) : "";
}

/** Recurring bookings only; anything else reads as not found. */
function assertRecurring(parts: BookingParts): void {
  if (parts.booking.kind !== "recurring") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
  }
  if (parts.booking.status !== "confirmed") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This series has ended." });
  }
}

/** The customer skips one visit; the cancellation policy applies to it (SPEC §21). */
export async function skipVisit(
  deps: BookingDeps,
  customerId: string,
  bookingId: string,
  visitId: string,
): Promise<{ refundCents: number; chargedCents: number }> {
  const now = deps.now();
  const done = await deps.db.transaction(async (tx) => {
    const parts = await lockedParts(tx, bookingId, undefined, visitId);
    if (parts.booking.customerId !== customerId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
    }
    assertRecurring(parts);
    assertTransition(parts, "cancel_by_customer", now);
    const money = await releaseVisit(tx, deps, parts, "customer", customerId, now);
    await audit(tx, "visit.skipped", "visit", visitId, customerId, {
      refundCents: money.refundCents,
    });
    await notify(
      tx,
      await businessTeamUserIds(tx, parts.booking.businessId),
      NOTIFICATION_TYPES.visitCancelled,
      {
        text: `Visit skipped: ${parts.booking.title}, ${visitWhen(parts)}`,
        path: seriesPath(parts.booking),
      },
    );
    const { series } = await loadSeries(tx, bookingId);
    return {
      parts,
      money,
      series,
      customer: await customerEmail(tx, customerId),
      team: await businessTeamEmails(tx, parts.booking.businessId),
    };
  });
  const chargedCents = await collectLateSkip(deps, done.parts.booking, visitId, done.money.late);
  const facts = seriesFacts(
    done.parts.booking,
    done.parts.business,
    done.series,
    deps.config.siteUrl,
  );
  const when = visitWhen(done.parts);
  await sendAll(deps.email, [
    ...seriesEmails.skippedForCustomer(done.customer, facts, when, {
      refundCents: done.money.refundCents,
      chargeCents: chargedCents,
    }),
    ...seriesEmails.skippedForBusiness(done.team, facts, when),
  ]);
  await pushNotifications(deps);
  return { refundCents: done.money.refundCents, chargedCents };
}

/** Visit states with no work in them; any other visit means the series did some work. */
const CANCELLED_VISIT_STATES: readonly string[] = [
  "cancelled_by_customer",
  "cancelled_by_business",
  "refunded",
];

/**
 * Ends a series early (SPEC §21). The customer: upcoming visits are skipped under the
 * policy (free outside its window). The business: upcoming visits are refunded in full.
 * Visits already done carry on to confirmation and payout.
 */
export async function endSeries(
  deps: BookingDeps,
  bookingId: string,
  how:
    | { by: "customer"; customerId: string }
    | { by: "business"; actorUserId: string | null; businessId?: string; reason: string },
): Promise<{ cancelled: number; refundCents: number; chargedCents: number }> {
  const now = deps.now();
  const [current] = await deps.db.select().from(bookings).where(eq(bookings.id, bookingId));
  const owns =
    current &&
    current.kind === "recurring" &&
    (how.by === "customer"
      ? current.customerId === how.customerId
      : !how.businessId || current.businessId === how.businessId);
  if (!current || !owns) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
  if (current.status === "requested") {
    if (how.by === "business") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Decline the request instead." });
    }
    await cancelByCustomer(deps, how.customerId, bookingId);
    return { cancelled: 0, refundCents: 0, chargedCents: 0 };
  }

  const actorUserId = how.by === "customer" ? how.customerId : how.actorUserId;
  const done = await deps.db.transaction(async (tx) => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for("update");
    if (booking?.status !== "confirmed") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This series has already ended." });
    }
    const upcoming = await tx
      .select({ id: visits.id })
      .from(visits)
      .where(
        and(
          eq(visits.bookingId, bookingId),
          eq(visits.status, "confirmed"),
          gt(visits.startsAt, now),
        ),
      )
      .orderBy(asc(visits.startsAt));
    let refundCents = 0;
    const lates: Array<{ visitId: string; late: Amounts }> = [];
    for (const { id } of upcoming) {
      const parts = await loadBookingParts(tx, bookingId, { visitId: id });
      if (!parts) continue;
      const money = await releaseVisit(tx, deps, parts, how.by, actorUserId, now);
      refundCents += money.refundCents;
      if (money.late) lates.push({ visitId: id, late: money.late });
    }
    const left = await tx
      .select({ status: visits.status })
      .from(visits)
      .where(eq(visits.bookingId, bookingId));
    const worked = left.some((visit) => !CANCELLED_VISIT_STATES.includes(visit.status));
    const [ended] = await tx
      .update(bookings)
      .set({
        status: worked
          ? "completed"
          : how.by === "customer"
            ? "cancelled_by_customer"
            : "cancelled_by_business",
        cancelledAt: now,
        cancellationReason: how.by === "business" ? how.reason : null,
      })
      .where(eq(bookings.id, bookingId))
      .returning();
    await audit(tx, "series.ended", "booking", bookingId, actorUserId, {
      by: how.by,
      cancelled: upcoming.length,
      refundCents,
    });
    const [business] = await tx
      .select()
      .from(businesses)
      .where(eq(businesses.id, booking.businessId));
    if (!business || !ended) throw new Error("series business missing");
    if (how.by === "customer") {
      await notify(
        tx,
        await businessTeamUserIds(tx, booking.businessId),
        NOTIFICATION_TYPES.ongoingEnded,
        { text: `Ended by the customer: ${booking.title}`, path: seriesPath(booking) },
      );
    } else {
      await notify(tx, [booking.customerId], NOTIFICATION_TYPES.ongoingEnded, {
        text: `${business.name} ended ${booking.title}`,
        path: `/bookings/${bookingId}`,
      });
    }
    const { series } = await loadSeries(tx, bookingId);
    return {
      booking: ended,
      business,
      series,
      cancelled: upcoming.length,
      refundCents,
      lates,
      customer: await customerEmail(tx, booking.customerId),
      team: await businessTeamEmails(tx, booking.businessId),
    };
  });
  let chargedCents = 0;
  for (const { visitId, late } of done.lates) {
    chargedCents += await collectLateSkip(deps, done.booking, visitId, late);
  }
  const facts = seriesFacts(done.booking, done.business, done.series, deps.config.siteUrl);
  const money = {
    refundCents: done.refundCents,
    chargeCents: chargedCents,
    cancelled: done.cancelled,
  };
  await sendAll(deps.email, [
    ...seriesEmails.endedForCustomer(
      done.customer,
      facts,
      how.by,
      money,
      how.by === "business" ? how.reason : undefined,
    ),
    ...(how.by === "customer"
      ? seriesEmails.endedForBusiness(done.team, facts, done.cancelled)
      : []),
  ]);
  await pushNotifications(deps);
  return { cancelled: done.cancelled, refundCents: done.refundCents, chargedCents };
}

/** The business moves one upcoming visit to another window or day (SPEC §21). */
export async function moveVisit(
  deps: BookingDeps,
  actorUserId: string,
  businessId: string,
  bookingId: string,
  visitId: string,
  target: { date: string; windowStart: number },
): Promise<void> {
  const now = deps.now();
  const date = parseIsoDate(target.date);
  if (!date) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a day." });
  const mail: Mail = [];
  const customerId = await deps.db.transaction(async (tx) => {
    await lockBusinessCapacity(tx, businessId);
    const parts = await lockedParts(tx, bookingId, businessId, visitId);
    assertRecurring(parts);
    const { booking, business, visit, payment } = parts;
    if (visit?.status !== "confirmed" || visit.startsAt.getTime() <= now.getTime()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only upcoming visits can be moved." });
    }
    const schedule = await loadSchedule(tx, business, date, 1, now, { excludeVisitId: visit.id });
    const check = checkWindow({
      now,
      rules: { minNoticeDays: 0, maxDaysAhead: SERIES_HORIZON_DAYS },
      windows: schedule.windows,
      members: schedule.members,
      placed: schedule.placed,
      workMinutes: visit.workMinutes,
      date,
      startMinute: target.windowStart,
      timeZone: booking.timezone,
    });
    if (!check.ok)
      throw new TRPCError({ code: "CONFLICT", message: WINDOW_MESSAGES[check.reason] });
    if (check.slot.startsAt.getTime() === visit.startsAt.getTime()) return null;
    const charged = payment?.status === "succeeded";
    await tx
      .update(visits)
      .set({
        startsAt: check.slot.startsAt,
        endsAt: check.slot.endsAt,
        remindedAt: null,
        chargeDueAt: charged
          ? null
          : chargeAtFor({
              kind: "recurring_visit",
              visitStartsAt: check.slot.startsAt,
              confirmedAt: now,
              timeZone: booking.timezone,
            }),
      })
      .where(eq(visits.id, visit.id));
    const from = whenLabel(visit.startsAt, visit.endsAt, booking.timezone);
    const to = whenLabel(check.slot.startsAt, check.slot.endsAt, booking.timezone);
    await audit(tx, "visit.moved", "visit", visit.id, actorUserId, {
      from: visit.startsAt.toISOString(),
      to: check.slot.startsAt.toISOString(),
    });
    await notify(tx, [booking.customerId], NOTIFICATION_TYPES.visitMoved, {
      text: `${business.name} moved a visit to ${to}`,
      path: `/bookings/${bookingId}`,
    });
    const { series } = await loadSeries(tx, bookingId);
    mail.push(
      ...seriesEmails.movedForCustomer(
        await customerEmail(tx, booking.customerId),
        seriesFacts(booking, business, series, deps.config.siteUrl),
        from,
        to,
      ),
    );
    return booking.customerId;
  });
  if (!customerId) return;
  // A visit moved less than 3 days out is charged now.
  await chargeOngoing(deps, { customerId });
  await sendAll(deps.email, mail);
  await pushNotifications(deps);
}

/** Open windows a visit could move to, from a day (default today) for `days` days. */
export async function moveOptions(
  db: DbExecutor,
  business: Business,
  visit: Visit,
  input: { from?: string; days: number },
  now: Date,
) {
  const rules: BookingWindowRules = { minNoticeDays: 0, maxDaysAhead: SERIES_HORIZON_DAYS };
  const range = bookableRange(now, rules, business.timezone);
  const from = (input.from ? parseIsoDate(input.from) : null) ?? range.first;
  const schedule = await loadSchedule(db, business, from, input.days, now, {
    excludeVisitId: visit.id,
  });
  const days = availableDays({
    now,
    rules,
    windows: schedule.windows,
    members: schedule.members,
    placed: schedule.placed,
    workMinutes: visit.workMinutes,
    from,
    days: input.days,
    timeZone: business.timezone,
  });
  return {
    days: days.map((day) => ({
      date: day.date,
      label: dateLabel(day.date),
      windows: day.windows.map((window) => ({
        startMinute: window.startMinute,
        label: formatArrivalWindow(window),
        available: window.available,
        current: window.startsAt.getTime() === visit.startsAt.getTime(),
      })),
    })),
  };
}

/** The business cancels one upcoming visit: a full refund if it was charged (SPEC §21). */
export async function cancelVisit(
  deps: BookingDeps,
  actorUserId: string,
  businessId: string,
  bookingId: string,
  visitId: string,
  reason: string,
): Promise<{ refundCents: number }> {
  const now = deps.now();
  const mail: Mail = [];
  const refundCents = await deps.db.transaction(async (tx) => {
    const parts = await lockedParts(tx, bookingId, businessId, visitId);
    assertRecurring(parts);
    assertTransition(parts, "cancel_by_business", now);
    const money = await releaseVisit(tx, deps, parts, "business", actorUserId, now);
    await audit(tx, "visit.cancelled", "visit", visitId, actorUserId, {
      reason,
      refundCents: money.refundCents,
    });
    await notify(tx, [parts.booking.customerId], NOTIFICATION_TYPES.visitCancelled, {
      text: `${parts.business.name} cancelled a visit: ${visitWhen(parts)}`,
      path: `/bookings/${bookingId}`,
    });
    const { series } = await loadSeries(tx, bookingId);
    mail.push(
      ...seriesEmails.visitCancelledForCustomer(
        await customerEmail(tx, parts.booking.customerId),
        seriesFacts(parts.booking, parts.business, series, deps.config.siteUrl),
        visitWhen(parts),
        money.refundCents,
        reason,
      ),
    );
    return money.refundCents;
  });
  await sendAll(deps.email, mail);
  await pushNotifications(deps);
  return { refundCents };
}

// ---------------------------------------------------------------------------------------
// Scheduled jobs
// ---------------------------------------------------------------------------------------

/** Reminds customers of tomorrow's recurring visits, once each (5 pm the day before). */
export async function remindVisits(deps: BookingDeps): Promise<number> {
  const now = deps.now();
  const rows = await deps.db
    .select({ visit: visits, booking: bookings, business: businesses })
    .from(visits)
    .innerJoin(bookings, eq(bookings.id, visits.bookingId))
    .innerJoin(businesses, eq(businesses.id, bookings.businessId))
    .where(
      and(
        eq(bookings.kind, "recurring"),
        eq(visits.status, "confirmed"),
        isNull(visits.remindedAt),
        gt(visits.startsAt, now),
        lte(visits.startsAt, new Date(now.getTime() + 2 * MS_PER_DAY)),
      ),
    );
  let reminded = 0;
  for (const { visit, booking, business } of rows) {
    if (now.getTime() < visitReminderAt(visit.startsAt, booking.timezone).getTime()) continue;
    const [claimed] = await deps.db
      .update(visits)
      .set({ remindedAt: now })
      .where(and(eq(visits.id, visit.id), isNull(visits.remindedAt)))
      .returning({ id: visits.id });
    if (!claimed) continue;
    const when = whenLabel(visit.startsAt, visit.endsAt, booking.timezone);
    await notify(deps.db, [booking.customerId], NOTIFICATION_TYPES.visitReminder, {
      text: `Tomorrow: ${business.name}, ${when.split(" · ")[1] ?? when}`,
      path: `/bookings/${booking.id}`,
    });
    const { series } = await loadSeries(deps.db, booking.id);
    await sendAll(
      deps.email,
      seriesEmails.reminderForCustomer(
        await customerEmail(deps.db, booking.customerId),
        seriesFacts(booking, business, series, deps.config.siteUrl),
        when,
      ),
    );
    reminded += 1;
  }
  if (reminded > 0) await pushNotifications(deps);
  return reminded;
}

/** A series ends by itself once its last day is over (SPEC §21). */
export async function finishSeries(deps: BookingDeps): Promise<number> {
  const due = await deps.db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(recurringSeries, eq(recurringSeries.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.kind, "recurring"),
        eq(bookings.status, "confirmed"),
        lte(recurringSeries.endsAt, deps.now()),
      ),
    );
  if (due.length === 0) return 0;
  const finished = await deps.db
    .update(bookings)
    .set({ status: "completed" })
    .where(
      and(
        inArray(
          bookings.id,
          due.map((row) => row.id),
        ),
        eq(bookings.status, "confirmed"),
      ),
    )
    .returning({ id: bookings.id });
  return finished.length;
}
