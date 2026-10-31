import {
  type LatLng,
  MS_PER_HOUR,
  refundForCustomerCancellation,
  type ServiceInput,
} from "@nevile/core";
import {
  and,
  asc,
  bookings,
  businesses,
  eq,
  inArray,
  notifications,
  payments,
  visits,
} from "@nevile/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runScheduledJobs } from "./bookings/jobs.ts";
import type { Context } from "./context.ts";
import { createCaller } from "./root.ts";
import { createHarness, type Harness, trpcError } from "./test/harness.ts";
import { errorReasonOf } from "./trpc.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const ABOUT = "Family-run lawn crew serving Bedford, Sackville and Halifax for ten years.";
const BEDFORD: LatLng = { lat: 44.7316, lng: -63.6545 };
/** Halifax wall-clock time in November 2026 (AST, UTC−4). */
const novAt = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 10, day, hour + 4, minute));
const mowing: ServiceInput = {
  categorySlug: "lawn-mowing",
  title: "Weekly mowing",
  description: "",
  pricingType: "fixed",
  priceCents: 6000,
  fromPriceCents: null,
  durationMinutes: 60,
  instantBook: true,
  active: true,
  recurrenceFrequencies: ["weekly", "biweekly"],
};
const address = { line1: "12 Example Lane", line2: "", city: "Halifax", postalCode: "B3H 4R2" };
/** Weekly on Tuesdays from November 3 to 24, 8–11 am. */
const tuesdays = {
  frequency: "weekly" as const,
  date: "2026-11-03",
  windowStart: 480,
  endDate: "2026-11-24",
};

describe.skipIf(!TEST_DATABASE_URL)("recurring jobs (SPEC §21)", () => {
  let harness: Harness;
  let owner: Context;
  let cora: Context;
  let coraId = "";
  let ownerUserId = "";
  let ownerMemberId = "";
  let businessId = "";
  let serviceId = "";
  let seriesId = "";
  let visitIds: string[] = [];

  const call = (ctx: Context) => createCaller(ctx);
  const deps = () => ({
    db: harness.db,
    payments: harness.payments,
    email: harness.anonymous().email,
    push: harness.anonymous().push,
    config: harness.anonymous().config,
    now: harness.clock.now,
  });
  const jobs = () => runScheduledJobs(deps(), harness.storage);
  const noticesFor = async (userId: string, type: string) =>
    harness.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.type, type)));
  const paymentsFor = (visitId: string) =>
    harness.db.select().from(payments).where(eq(payments.visitId, visitId));
  const lastEmail = (to: string, subject: RegExp) =>
    harness.emails.findLast((message) => message.to === to && subject.test(message.subject));

  async function saveCard(ctx: Context, declining = false) {
    const setup = await call(ctx).cards.startSetup({ kind: "intent" });
    await call(ctx).cards.payTestSetup({ setupId: setup.setupId, declining });
  }

  async function requestAndAccept(ctx: Context, schedule: typeof tuesdays) {
    const { bookingId } = await call(ctx).recurring.request({
      serviceId,
      ...schedule,
      overrides: [],
      address,
      notes: "",
    });
    await call(owner).businessBookings.accept({ businessId, bookingId });
    const rows = await harness.db
      .select()
      .from(visits)
      .where(eq(visits.bookingId, bookingId))
      .orderBy(asc(visits.sequence));
    return { bookingId, visits: rows };
  }

  beforeAll(async () => {
    harness = await createHarness(TEST_DATABASE_URL as string);
    harness.clock.set(novAt(2, 9));
    const signedUp = await harness.signUp("ann@example.com", "Ann Owner");
    owner = signedUp.ctx;
    ownerUserId = signedUp.userId;
    businessId = (await call(owner).business.create({ name: "Ann's Lawns", province: "NS" })).id;
    await call(owner).listing.updateProfile({
      businessId,
      name: "Ann's Lawns",
      description: ABOUT,
      gstHstNumber: "",
      cancellationPolicy: "flexible",
      instantBook: true,
    });
    await call(owner).listing.setServiceArea({ businessId, center: BEDFORD, radiusKm: 25 });
    serviceId = (await call(owner).listing.createService({ businessId, ...mowing })).id;
    await call(owner).listing.publish({ businessId });
    // Payouts are set up, so the payout-setup deadline never cancels anything here.
    await harness.db
      .update(businesses)
      .set({ payoutsEnabled: true, stripeAccountId: "acct_test_ann" })
      .where(eq(businesses.id, businessId));
    ownerMemberId =
      (await call(owner).team.members({ businessId })).find((member) => member.isYou)?.id ?? "";
    const customer = await harness.signUp("cora@example.com", "Cora Customer");
    cora = customer.ctx;
    coraId = customer.userId;
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("offers the pro's schedules and previews every date with the price", async () => {
    const availability = await call(cora).bookings.availability({ serviceId, days: 7 });
    expect(availability.service.recurrenceFrequencies).toEqual(["weekly", "biweekly"]);

    const preview = await call(cora).recurring.preview({ serviceId, ...tuesdays, overrides: [] });
    expect(preview.summary).toBe("Every week · 4 visits");
    expect(preview.dates.map((date) => [date.date, date.status])).toEqual([
      ["2026-11-03", "ok"],
      ["2026-11-10", "ok"],
      ["2026-11-17", "ok"],
      ["2026-11-24", "ok"],
    ]);
    expect(preview.price.totalCents).toBe(6453);
    expect(preview.totalCents).toBe(4 * 6453);
    expect(preview.problem).toBeNull();

    // Only the frequencies the pro allows, and at most 6 months.
    const monthly = await trpcError(
      call(cora).recurring.preview({ serviceId, ...tuesdays, frequency: "monthly", overrides: [] }),
    );
    expect(monthly.message).toContain("every month");
    const tooLong = await trpcError(
      call(cora).recurring.preview({
        serviceId,
        ...tuesdays,
        endDate: "2027-06-01",
        overrides: [],
      }),
    );
    expect(tooLong.code).toBe("BAD_REQUEST");
  });

  it("flags full dates, needs a saved card, then sends a request the pro must accept", async () => {
    // Ann is off the morning of November 10: that window is full.
    await call(owner).team.addTimeOff({
      businessId,
      memberId: ownerMemberId,
      startsAt: novAt(10, 8),
      endsAt: novAt(10, 11),
    });
    const preview = await call(cora).recurring.preview({ serviceId, ...tuesdays, overrides: [] });
    expect(preview.dates[1]).toMatchObject({
      date: "2026-11-10",
      status: "full",
      alternatives: [
        { startMinute: 660, label: "11 am–2 pm" },
        { startMinute: 840, label: "2–5 pm" },
      ],
    });
    expect(preview.problem).toBe("One date is full. Skip it or pick another window that day.");
    const moved = [{ date: "2026-11-10", windowStart: 660 }];

    // No saved card yet.
    const noCard = await trpcError(
      call(cora).recurring.request({
        serviceId,
        ...tuesdays,
        overrides: moved,
        address,
        notes: "",
      }),
    );
    expect(noCard.code).toBe("PRECONDITION_FAILED");
    expect(errorReasonOf(noCard)).toBe("CARD_REQUIRED");
    await saveCard(cora);
    expect(await call(cora).cards.get()).toMatchObject({ label: "Visa •••• 4242" });

    // Full dates must be skipped or moved.
    const full = await trpcError(
      call(cora).recurring.request({ serviceId, ...tuesdays, overrides: [], address, notes: "" }),
    );
    expect(full.code).toBe("CONFLICT");

    const { bookingId } = await call(cora).recurring.request({
      serviceId,
      ...tuesdays,
      overrides: moved,
      address,
      notes: "Gate code 1234",
    });
    seriesId = bookingId;
    const view = await call(cora).bookings.get({ bookingId });
    expect(view).toMatchObject({
      kind: "recurring",
      status: "requested",
      statusLabel: "Waiting for the pro",
      ongoing: { frequencyLabel: "Every week", visits: [], counts: { visits: 0 } },
    });
    // Nothing is charged before the pro accepts.
    expect(
      await harness.db.select().from(payments).where(eq(payments.bookingId, bookingId)),
    ).toEqual([]);
    const inbox = await call(owner).businessBookings.inbox({ businessId });
    expect(inbox.requests).toMatchObject([
      { id: bookingId, series: "Every week · 4 visits", actions: { accept: true } },
    ]);
    expect(lastEmail("cora@example.com", /^Request sent to Ann's Lawns/)?.text).toContain(
      "4 visits at $64.53 each",
    );
    expect(lastEmail("ann@example.com", /^Recurring booking request/)).toBeDefined();
    expect(await noticesFor(ownerUserId, "ongoing.requested")).toHaveLength(1);

    // One open request per service.
    const again = await trpcError(
      call(cora).recurring.request({
        serviceId,
        ...tuesdays,
        overrides: moved,
        address,
        notes: "",
      }),
    );
    expect(again.code).toBe("CONFLICT");
  });

  it("accepting places the visits, skips dates that stopped fitting and charges near ones", async () => {
    // November 24 stopped fitting after the request.
    await call(owner).team.addTimeOff({
      businessId,
      memberId: ownerMemberId,
      startsAt: novAt(24, 0),
      endsAt: novAt(25, 0),
    });
    const outcome = await call(owner).businessBookings.accept({ businessId, bookingId: seriesId });
    expect(outcome).toEqual({ ok: true, visits: 3, skipped: ["Tuesday, November 24"] });

    visitIds = (
      await harness.db
        .select()
        .from(visits)
        .where(eq(visits.bookingId, seriesId))
        .orderBy(asc(visits.sequence))
    ).map((visit) => visit.id);
    expect(visitIds).toHaveLength(3);
    // The first visit is less than 3 days away: charged at acceptance.
    expect(await paymentsFor(visitIds[0] ?? "")).toMatchObject([
      { status: "succeeded", amountCents: 6453, releasedAt: null },
    ]);

    const view = await call(cora).bookings.get({ bookingId: seriesId });
    expect(view.status).toBe("confirmed");
    expect(view.ongoing?.visits.map((visit) => visit.charge.state)).toEqual([
      "charged",
      "scheduled",
      "scheduled",
    ]);
    expect(view.ongoing?.visits[1]).toMatchObject({
      window: { label: "Tuesday, November 10 · 11 am–2 pm" },
      charge: { dueAt: novAt(7, 11) },
      actions: { skip: true },
      skip: { text: "Free to skip: it hasn't been charged." },
    });
    expect(lastEmail("cora@example.com", /^Accepted: Weekly mowing/)?.text).toContain(
      "Tuesday, November 24",
    );

    // Each visit is its own job on the calendar, marked with the series.
    const calendar = await call(owner).businessBookings.calendar({
      businessId,
      from: "2026-11-02",
      days: 7,
    });
    const jobs = calendar.days.flatMap((day) => day.windows.flatMap((window) => window.jobs));
    expect(jobs).toMatchObject([
      { key: visitIds[0], visitId: visitIds[0], series: "Every week · visit 1 of 3" },
    ]);
    const page = await call(owner).businessBookings.ongoing({ businessId, bookingId: seriesId });
    expect(page).toMatchObject({
      status: "confirmed",
      customer: { firstName: "Cora", email: "cora@example.com" },
      actions: { end: true, accept: false },
    });
    expect(page.ongoing.visits).toHaveLength(3);
    expect(page.ongoing.visits[0]?.actions).toMatchObject({ move: true, cancel: true });
  });

  it("visits complete one by one; charges 3 days before; reminders the day before", async () => {
    const [first, second] = visitIds;
    harness.clock.set(novAt(3, 9));
    await call(owner).businessBookings.markDone({
      businessId,
      bookingId: seriesId,
      visitId: first ?? "",
    });
    await call(cora).bookings.confirmDone({ bookingId: seriesId, visitId: first });
    expect((await paymentsFor(first ?? ""))[0]?.releasedAt).toEqual(novAt(3, 9));

    harness.clock.set(novAt(7, 11, 5));
    await jobs();
    expect(await paymentsFor(second ?? "")).toMatchObject([{ status: "succeeded" }]);

    harness.clock.set(novAt(9, 17, 1));
    await jobs();
    await jobs();
    expect(await noticesFor(coraId, "visit.reminder")).toMatchObject([
      { payload: { text: "Tomorrow: Ann's Lawns, 11 am–2 pm", path: `/bookings/${seriesId}` } },
    ]);
    expect(lastEmail("cora@example.com", /^Tomorrow: Weekly mowing/)).toBeDefined();
  });

  it("the pro moves a visit; the customer skips one late and ends the series", async () => {
    const [, second, third] = visitIds;
    harness.clock.set(novAt(9, 17, 30));
    const options = await call(owner).businessBookings.moveOptions({
      businessId,
      bookingId: seriesId,
      visitId: third ?? "",
      from: "2026-11-18",
      days: 1,
    });
    expect(options.days[0]?.windows.map((window) => window.available)).toEqual([true, true, true]);
    await call(owner).businessBookings.moveVisit({
      businessId,
      bookingId: seriesId,
      visitId: third ?? "",
      date: "2026-11-18",
      windowStart: 840,
    });
    const [moved] = await harness.db
      .select()
      .from(visits)
      .where(eq(visits.id, third ?? ""));
    expect(moved).toMatchObject({ startsAt: novAt(18, 14), chargeDueAt: novAt(15, 14) });
    expect(await noticesFor(coraId, "visit.moved")).toHaveLength(1);
    expect(lastEmail("cora@example.com", /^Ann's Lawns moved a visit/)?.text).toContain(
      "Now: Wednesday, November 18 · 2–5 pm",
    );

    // Skipping the charged visit inside the 24-hour window: half the price back.
    harness.clock.set(novAt(10, 7));
    const [paid] = await paymentsFor(second ?? "");
    const expected = refundForCustomerCancellation({
      priceCents: paid?.priceCents ?? 0,
      serviceFeeCents: paid?.serviceFeeCents ?? 0,
      taxOnPriceCents: paid?.priceTaxCents ?? 0,
      taxOnFeeCents: paid?.feeTaxCents ?? 0,
      policy: "flexible",
      jobStartsAt: novAt(10, 11),
      jobTimeZone: "America/Halifax",
      cancelledAt: novAt(10, 7),
    });
    const skipped = await call(cora).recurring.skipVisit({
      bookingId: seriesId,
      visitId: second ?? "",
    });
    expect(skipped).toEqual({ refundCents: expected.totalRefundCents, chargedCents: 0 });
    expect(expected.isFreeCancellation).toBe(false);
    expect((await paymentsFor(second ?? ""))[0]?.status).toBe("partially_refunded");
    expect(await noticesFor(ownerUserId, "visit.cancelled")).toHaveLength(1);

    // Ending the series cancels the rest (free: not charged yet); done visits stay.
    const ended = await call(cora).bookings.cancel({ bookingId: seriesId });
    expect(ended.status).toBe("completed");
    expect(ended.ongoing?.visits.map((visit) => visit.status)).toEqual([
      "completed",
      "cancelled_by_customer",
      "cancelled_by_customer",
    ]);
    expect(lastEmail("ann@example.com", /^Ended by the customer/)).toBeDefined();
    expect(await paymentsFor(third ?? "")).toEqual([]);
  });

  it("a strict policy's late skip of an unpaid visit charges what the policy keeps", async () => {
    await call(owner).listing.updateProfile({
      businessId,
      name: "Ann's Lawns",
      description: ABOUT,
      gstHstNumber: "",
      cancellationPolicy: "strict",
      instantBook: true,
    });
    const dee = await harness.signUp("dee@example.com", "Dee Customer");
    await saveCard(dee.ctx);
    const series = await requestAndAccept(dee.ctx, {
      frequency: "weekly",
      date: "2026-11-25",
      windowStart: 480,
      endDate: "2026-12-09",
    });
    expect(series.visits).toHaveLength(3);
    const [first] = series.visits;
    expect(await paymentsFor(first?.id ?? "")).toEqual([]);

    // 6 days before: past the strict policy's 7-day free window, and not yet charged.
    harness.clock.set(novAt(19, 8));
    const skipped = await call(dee.ctx).recurring.skipVisit({
      bookingId: series.bookingId,
      visitId: first?.id ?? "",
    });
    expect(skipped).toEqual({ refundCents: 0, chargedCents: 6453 });
    expect(await paymentsFor(first?.id ?? "")).toMatchObject([
      { status: "succeeded", amountCents: 6453, releasedAt: novAt(19, 8) },
    ]);
  });

  it("a declined card is retried daily, then the visit is cancelled and the series paused", async () => {
    harness.clock.set(novAt(19, 10));
    const eve = await harness.signUp("eve@example.com", "Eve Customer");
    await saveCard(eve.ctx, true);
    const series = await requestAndAccept(eve.ctx, {
      frequency: "weekly",
      date: "2026-11-26",
      windowStart: 480,
      endDate: "2026-12-10",
    });
    const [first, second] = series.visits;

    // Due 3 days before (Nov 23, 8 am): declined, and Eve is told at once.
    harness.clock.set(novAt(23, 8, 5));
    await jobs();
    expect(await paymentsFor(first?.id ?? "")).toMatchObject([{ status: "failed" }]);
    expect(await noticesFor(eve.userId, "payment.failed")).toHaveLength(1);
    expect(lastEmail("eve@example.com", /^Your card didn't go through/)).toBeDefined();

    // A day later: retried (declined again), no second notice.
    harness.clock.set(novAt(24, 8, 10));
    await jobs();
    expect(await paymentsFor(first?.id ?? "")).toHaveLength(2);
    expect(await noticesFor(eve.userId, "payment.failed")).toHaveLength(1);

    // 24 hours before the visit: cancelled, and the series paused.
    harness.clock.set(novAt(25, 8, 5));
    await jobs();
    const [cancelled] = await harness.db
      .select()
      .from(visits)
      .where(eq(visits.id, first?.id ?? ""));
    expect(cancelled?.status).toBe("cancelled_by_customer");
    const view = await call(eve.ctx).bookings.get({ bookingId: series.bookingId });
    expect(view.statusLabel).toBe("Paused");
    expect(view.ongoing?.paused?.text).toContain("Update it to resume");
    expect(await noticesFor(ownerUserId, "booking.paused")).toHaveLength(1);

    // A new card resumes the series (nothing is owed), and the next visit is charged on time.
    await saveCard(eve.ctx);
    const [resumed] = await harness.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, series.bookingId));
    expect(resumed?.pausedAt).toBeNull();
    harness.clock.set(novAt(30, 8, 5));
    await jobs();
    expect(await paymentsFor(second?.id ?? "")).toMatchObject([{ status: "succeeded" }]);
  });

  it("an unanswered request expires after 24 hours with nothing charged", async () => {
    harness.clock.set(novAt(30, 9));
    const fay = await harness.signUp("fay@example.com", "Fay Customer");
    await saveCard(fay.ctx);
    const { bookingId } = await call(fay.ctx).recurring.request({
      serviceId,
      frequency: "biweekly",
      date: "2026-12-07",
      windowStart: 660,
      endDate: "2027-01-04",
      overrides: [],
      address,
      notes: "",
    });
    harness.clock.set(new Date(novAt(30, 9).getTime() + 25 * MS_PER_HOUR));
    await jobs();
    const view = await call(fay.ctx).bookings.get({ bookingId });
    expect(view.status).toBe("expired");
    expect(await noticesFor(fay.userId, "ongoing.declined")).toHaveLength(1);
    expect(lastEmail("fay@example.com", /expired$/)?.text).toContain("You weren't charged.");
    const charged = await harness.db
      .select()
      .from(payments)
      .where(inArray(payments.bookingId, [bookingId]));
    expect(charged).toEqual([]);
  });
});
