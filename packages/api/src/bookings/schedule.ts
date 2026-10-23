import {
  type ArrivalWindow,
  type BookingWindowRules,
  type CalendarDate,
  DEFAULT_ARRIVAL_WINDOWS,
  DEFAULT_WORKING_HOURS,
  fromLocal,
  type MemberAvailability,
  type PlacedWork,
} from "@nevile/core";
import {
  and,
  arrivalWindows,
  asc,
  availabilityRules,
  type Business,
  bookingCheckouts,
  businessMembers,
  type DbExecutor,
  eq,
  gt,
  gte,
  inArray,
  lt,
  ne,
  notInArray,
  sql,
  timeOff,
  visits,
} from "@nevile/db";

/** Visit states that no longer use any time (SPEC §19). */
export const FREED_VISIT_STATES = [
  "cancelled_by_customer",
  "cancelled_by_business",
  "refunded",
] as const;

/** The business's arrival windows, or the defaults when it hasn't set its own. */
export async function windowsFor(db: DbExecutor, businessId: string): Promise<ArrivalWindow[]> {
  const rows = await db
    .select({ startMinute: arrivalWindows.startMinute, endMinute: arrivalWindows.endMinute })
    .from(arrivalWindows)
    .where(eq(arrivalWindows.businessId, businessId))
    .orderBy(asc(arrivalWindows.startMinute));
  return rows.length > 0 ? rows : [...DEFAULT_ARRIVAL_WINDOWS];
}

/** Active crew members with their weekly hours and time off inside [from, to). */
export async function crewAvailability(
  db: DbExecutor,
  businessId: string,
  range: { from: Date; to: Date },
): Promise<MemberAvailability[]> {
  const members = await db
    .select({ id: businessMembers.id })
    .from(businessMembers)
    .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.active, true)));
  if (members.length === 0) return [];
  const ids = members.map((member) => member.id);
  const hours = await db
    .select()
    .from(availabilityRules)
    .where(inArray(availabilityRules.memberId, ids));
  const offs = await db
    .select()
    .from(timeOff)
    .where(
      and(
        inArray(timeOff.memberId, ids),
        lt(timeOff.startsAt, range.to),
        gt(timeOff.endsAt, range.from),
      ),
    );
  return ids.map((memberId) => ({
    memberId,
    hours: hours.filter((rule) => rule.memberId === memberId),
    timeOff: offs.filter((block) => block.memberId === memberId),
  }));
}

/**
 * Work already using time in [from, to): live visits and checkouts still being paid for
 * (SPEC §19). `excludeCheckoutId` leaves out the caller's own hold.
 */
export async function placedWork(
  db: DbExecutor,
  businessId: string,
  range: { from: Date; to: Date },
  now: Date,
  options: { excludeCheckoutId?: string } = {},
): Promise<PlacedWork[]> {
  const jobs = await db
    .select({ startsAt: visits.startsAt, workMinutes: visits.workMinutes })
    .from(visits)
    .where(
      and(
        eq(visits.businessId, businessId),
        gte(visits.startsAt, range.from),
        lt(visits.startsAt, range.to),
        notInArray(visits.status, [...FREED_VISIT_STATES]),
      ),
    );
  const holds = await db
    .select({ startsAt: bookingCheckouts.startsAt, workMinutes: bookingCheckouts.workMinutes })
    .from(bookingCheckouts)
    .where(
      and(
        eq(bookingCheckouts.businessId, businessId),
        eq(bookingCheckouts.status, "open"),
        gt(bookingCheckouts.expiresAt, now),
        gte(bookingCheckouts.startsAt, range.from),
        lt(bookingCheckouts.startsAt, range.to),
        options.excludeCheckoutId ? ne(bookingCheckouts.id, options.excludeCheckoutId) : undefined,
      ),
    );
  return [...jobs, ...holds];
}

/** Local midnight at the start of `first` to local midnight after `last`. */
export function dayRange(first: CalendarDate, days: number, timeZone: string) {
  const from = fromLocal(first, timeZone);
  const to = fromLocal({ ...first, day: first.day + days }, timeZone);
  return { from, to };
}

export function noticeRules(
  business: Pick<Business, "minNoticeDays" | "maxDaysAhead">,
): BookingWindowRules {
  return { minNoticeDays: business.minNoticeDays, maxDaysAhead: business.maxDaysAhead };
}

/** Everything the capacity rules need for `days` days from `first`. */
export async function loadSchedule(
  db: DbExecutor,
  business: Pick<Business, "id" | "timezone">,
  first: CalendarDate,
  days: number,
  now: Date,
  options: { excludeCheckoutId?: string } = {},
) {
  const range = dayRange(first, days, business.timezone);
  const [windows, members, placed] = await Promise.all([
    windowsFor(db, business.id),
    crewAvailability(db, business.id, range),
    placedWork(db, business.id, range, now, options),
  ]);
  return { windows, members, placed, range };
}

/**
 * Serialises capacity decisions for one business (checkouts, accepting requests), so two
 * customers can never both take the last time in a window. Hold it inside a transaction.
 */
export async function lockBusinessCapacity(tx: DbExecutor, businessId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`capacity:${businessId}`}))`);
}

/** Default weekly hours for a new crew member (SPEC §19). */
export async function addDefaultHours(tx: DbExecutor, memberId: string): Promise<void> {
  await tx
    .insert(availabilityRules)
    .values(DEFAULT_WORKING_HOURS.map((hours) => ({ memberId, ...hours })))
    .onConflictDoNothing();
}
