import type { LatLng, ServiceInput } from "@nevile/core";
import {
  bookingCheckouts,
  bookings,
  businesses,
  eq,
  payments,
  payouts,
  refunds,
  services,
  visits,
} from "@nevile/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runScheduledJobs } from "./bookings/jobs.ts";
import { handlePaymentEvent } from "./bookings/payouts.ts";
import type { Context } from "./context.ts";
import { createCaller } from "./root.ts";
import { createHarness, type Harness, trpcError } from "./test/harness.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const ABOUT = "Family-run lawn crew serving Bedford, Sackville and Halifax for ten years.";
const BEDFORD: LatLng = { lat: 44.7316, lng: -63.6545 };
/** Halifax wall-clock time on 2026-11-dd (Atlantic Standard Time, UTC−4). */
const novAt = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 10, day, hour + 4, minute));

const mowing: ServiceInput = {
  categorySlug: "lawn-mowing",
  title: "Big-yard mowing",
  description: "",
  pricingType: "fixed",
  priceCents: 6000,
  fromPriceCents: null,
  durationMinutes: 120,
  instantBook: true,
  active: true,
};
const address = { line1: "12 Example Lane", line2: "", city: "Halifax", postalCode: "B3H 1A1" };

describe.skipIf(!TEST_DATABASE_URL)("one-off bookings (SPEC §19)", () => {
  let harness: Harness;
  let owner: Context;
  let customer: Context;
  let other: Context;
  let businessId = "";
  let serviceId = "";
  let ownerEmail = "";

  const call = (ctx: Context) => createCaller(ctx);
  const deps = () => ({
    db: harness.db,
    payments: harness.payments,
    email: {
      send: async (message: (typeof harness.emails)[number]) => void harness.emails.push(message),
    },
    config: harness.anonymous().config,
    now: harness.clock.now,
  });

  /** Opens a checkout and pays it on the fake provider, like a customer would. */
  async function book(
    ctx: Context,
    input: { date: string; windowStart: number; service?: string },
  ) {
    const { url } = await call(ctx).bookings.checkout({
      serviceId: input.service ?? serviceId,
      date: input.date,
      windowStart: input.windowStart,
      address,
      notes: "Gate code 1234",
    });
    const sessionId = decodeURIComponent(url.split("/").at(-1) ?? "");
    const { event } = harness.payments.payCheckout(sessionId);
    await handlePaymentEvent(deps(), event);
    const outcome = await call(ctx).bookings.finishCheckout({ sessionId });
    if (!("bookingId" in outcome)) throw new Error(`not booked: ${outcome.status}`);
    return { bookingId: outcome.bookingId, sessionId, status: outcome.status };
  }

  beforeAll(async () => {
    harness = await createHarness(TEST_DATABASE_URL as string);
    // Sunday, November 1 2026, 10 am in Halifax.
    harness.clock.set(novAt(1, 10));
    ownerEmail = "bea@example.com";
    owner = (await harness.signUp(ownerEmail, "Bea Owner")).ctx;
    const created = await call(owner).business.create({
      name: "Bedford Big Yards",
      province: "NS",
    });
    businessId = created.id;
    await call(owner).listing.updateProfile({
      businessId,
      name: "Bedford Big Yards",
      description: ABOUT,
      gstHstNumber: "",
      cancellationPolicy: "flexible",
      instantBook: true,
    });
    await call(owner).listing.setServiceArea({ businessId, center: BEDFORD, radiusKm: 25 });
    serviceId = (await call(owner).listing.createService({ businessId, ...mowing })).id;
    await call(owner).listing.publish({ businessId });
    customer = (await harness.signUp("cora@example.com", "Cora Customer")).ctx;
    other = (await harness.signUp("otto@example.com", "Otto Other")).ctx;
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("shows open windows and the price breakdown", async () => {
    const view = await call(harness.anonymous()).bookings.availability({ serviceId, days: 7 });
    expect(view.firstDate).toBe("2026-11-02");
    expect(view.instantBook).toBe(true);
    // Not GST/HST-registered: HST on the service fee only (SPEC §7 reference values).
    expect(view.price).toEqual({
      priceCents: 6000,
      serviceFeeCents: 397,
      taxCents: 56,
      totalCents: 6453,
    });
    const monday = view.days.find((day) => day.date === "2026-11-02");
    expect(monday?.windows.map((window) => [window.label, window.available])).toEqual([
      ["8–11 am", true],
      ["11 am–2 pm", true],
      ["2–5 pm", true],
    ]);
    const saturday = view.days.find((day) => day.date === "2026-11-07");
    expect(saturday?.windows.some((window) => window.available)).toBe(false);
  });

  it("holds a window while a customer pays, so it can't be sold twice", async () => {
    // One person, a 3-hour window, a 2-hour job: one checkout fills it.
    const { url } = await call(customer).bookings.checkout({
      serviceId,
      date: "2026-11-02",
      windowStart: 480,
      address,
      notes: "",
    });
    expect(url).toContain("/dev/fake-checkout/");
    const full = await trpcError(
      call(other).bookings.checkout({
        serviceId,
        date: "2026-11-02",
        windowStart: 480,
        address,
        notes: "",
      }),
    );
    expect(full.code).toBe("CONFLICT");
    expect(full.message).toBe("That window just filled up. Pick another time.");
    // After 31 minutes the hold lapses and the window opens again.
    harness.clock.set(novAt(1, 10, 32));
    await runScheduledJobs(deps());
    const [expired] = await harness.db
      .select({ status: bookingCheckouts.status })
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.customerId, customer.session?.user.id ?? ""));
    expect(expired?.status).toBe("expired");
    harness.clock.set(novAt(1, 10));
  });

  it("refuses addresses outside the area, quote services and the business's own team", async () => {
    const far = await trpcError(
      call(customer).bookings.checkout({
        serviceId,
        date: "2026-11-02",
        windowStart: 660,
        address: { ...address, postalCode: "B1P 1A1" },
        notes: "",
      }),
    );
    expect(far.code).toBe("BAD_REQUEST");
    expect(far.message).toContain("outside Bedford Big Yards's service area");
    const own = await trpcError(
      call(owner).bookings.checkout({
        serviceId,
        date: "2026-11-02",
        windowStart: 660,
        address,
        notes: "",
      }),
    );
    expect(own.code).toBe("FORBIDDEN");
    const tooSoon = await trpcError(
      call(customer).bookings.checkout({
        serviceId,
        date: "2026-11-01",
        windowStart: 840,
        address,
        notes: "",
      }),
    );
    expect(tooSoon.message).toBe("That time is too soon to book. Pick a later day.");
  });

  let bookingId = "";

  it("books and charges Instant Book jobs once, and starts the payout-setup clock", async () => {
    harness.emails.length = 0;
    const booked = await book(customer, { date: "2026-11-02", windowStart: 480 });
    bookingId = booked.bookingId;
    expect(booked.status).toBe("booked");
    // Finishing again (webhook + return page) changes nothing.
    expect(await call(customer).bookings.finishCheckout({ sessionId: booked.sessionId })).toEqual({
      status: "booked",
      bookingId,
    });
    const [row] = await harness.db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row).toMatchObject({
      status: "confirmed",
      totalCents: 6453,
      customerNotes: "Gate code 1234",
    });
    const [visit] = await harness.db.select().from(visits).where(eq(visits.bookingId, bookingId));
    expect(visit).toMatchObject({ assignedMemberId: null, workMinutes: 120, status: "confirmed" });
    const [payment] = await harness.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, bookingId));
    expect(payment).toMatchObject({ status: "succeeded", provider: "fake", businessFeeCents: 180 });
    const [business] = await harness.db
      .select()
      .from(businesses)
      .where(eq(businesses.id, businessId));
    expect(business?.payoutSetupDueAt?.toISOString()).toBe(novAt(8, 10).toISOString());
    const subjects = harness.emails.map((message) => `${message.to}: ${message.subject}`);
    expect(subjects).toContain("cora@example.com: Booked: Big-yard mowing with Bedford Big Yards");
    expect(subjects).toContain(
      `${ownerEmail}: New booking: Big-yard mowing, Monday, November 2 · 8–11 am`,
    );
    expect(subjects).toContain(`${ownerEmail}: Set up payouts to keep taking bookings`);
  });

  it("shows customers their own bookings only", async () => {
    const list = await call(customer).bookings.list();
    expect(list.upcoming.map((view) => view.id)).toContain(bookingId);
    const view = await call(customer).bookings.get({ bookingId });
    expect(view).toMatchObject({
      status: "confirmed",
      statusLabel: "Booked",
      window: { label: "Monday, November 2 · 8–11 am" },
      actions: { cancel: true, confirmDone: false },
    });
    // Within 24 hours of the window (Flexible): half the price back, fee kept.
    expect(view.cancelQuote).toMatchObject({ free: false, refundCents: 3000 });
    expect((await trpcError(call(other).bookings.get({ bookingId }))).code).toBe("NOT_FOUND");
    expect((await trpcError(call(other).bookings.cancel({ bookingId }))).code).toBe("NOT_FOUND");
  });

  let crewMemberId = "";
  let crew: Context;

  it("invites crew by email, who then see only the jobs assigned to them", async () => {
    harness.emails.length = 0;
    await call(owner).team.invite({ businessId, email: "cris@example.com", role: "crew" });
    const link = harness.emails.find((message) => message.to === "cris@example.com")?.text ?? "";
    const token = link.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1] ?? "";
    expect(await call(harness.anonymous()).team.inviteInfo({ token })).toEqual({
      valid: true,
      businessName: "Bedford Big Yards",
      roleLabel: "Crew",
    });
    // Someone else can't use the link.
    expect((await trpcError(call(other).team.acceptInvite({ token }))).code).toBe("FORBIDDEN");
    crew = (await harness.signUp("cris@example.com", "Cris Crew")).ctx;
    await call(crew).team.acceptInvite({ token });
    expect((await trpcError(call(crew).team.acceptInvite({ token }))).code).toBe("NOT_FOUND");

    const team = await call(owner).team.members({ businessId });
    crewMemberId = team.find((row) => row.name === "Cris Crew")?.id ?? "";
    expect(team.find((row) => row.id === crewMemberId)?.hours).toHaveLength(5);

    let crewView = await call(crew).businessBookings.calendar({
      businessId,
      from: "2026-11-02",
      days: 1,
    });
    expect(crewView.days[0]?.windows[0]?.jobs).toEqual([]);
    expect(
      (
        await trpcError(
          call(crew).businessBookings.assign({ businessId, bookingId, memberId: crewMemberId }),
        )
      ).code,
    ).toBe("FORBIDDEN");
    await call(owner).businessBookings.assign({ businessId, bookingId, memberId: crewMemberId });
    crewView = await call(crew).businessBookings.calendar({
      businessId,
      from: "2026-11-02",
      days: 1,
    });
    const job = crewView.days[0]?.windows[0]?.jobs[0];
    expect(job).toMatchObject({
      id: bookingId,
      assignee: { id: crewMemberId, name: "Cris Crew" },
      customer: { firstName: "Cora", email: "cora@example.com" },
      address: ["12 Example Lane", "Halifax, NS B3H 1A1"],
    });
    // With two people working, the 8–11 window now has room again.
    expect(crewView.days[0]?.windows[0]).toMatchObject({ capacityMinutes: 360, freeMinutes: 240 });
    expect(
      (await trpcError(call(other).businessBookings.calendar({ businessId, from: "2026-11-02" })))
        .code,
    ).toBe("NOT_FOUND");
  });

  it("completes a job: done after the window starts, problem, fix, confirmation", async () => {
    const early = await trpcError(call(crew).businessBookings.markDone({ businessId, bookingId }));
    expect(early.message).toBe("You can mark it done once the arrival window has started.");
    harness.clock.set(novAt(2, 10));
    await call(crew).businessBookings.markDone({ businessId, bookingId });
    let view = await call(customer).bookings.get({ bookingId });
    expect(view.actions).toMatchObject({ confirmDone: true, reportProblem: true, cancel: false });

    await call(customer).bookings.reportProblem({
      bookingId,
      reason: "The back yard wasn't mowed at all.",
    });
    view = await call(customer).bookings.get({ bookingId });
    expect(view.status).toBe("disputed");
    await call(owner).businessBookings.scheduleFix({ businessId, bookingId });
    await call(crew).businessBookings.markFixed({ businessId, bookingId });
    await call(customer).bookings.confirmDone({ bookingId });
    view = await call(customer).bookings.get({ bookingId });
    expect(view.status).toBe("completed");
    const [payment] = await harness.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, bookingId));
    expect(payment?.releasedAt).not.toBeNull();
  });

  it("pays the business on Monday once payout setup is done", async () => {
    harness.clock.set(novAt(9, 0, 10));
    await runScheduledJobs(deps());
    // No payout setup yet: nothing is paid, and the 7-day deadline has passed.
    expect(await harness.db.select().from(payouts)).toEqual([]);
    const status = await call(owner).payouts.status({ businessId });
    expect(status).toMatchObject({ payoutsEnabled: false, bookingsPaused: true });
    const paused = await trpcError(
      call(customer).bookings.checkout({
        serviceId,
        date: "2026-11-12",
        windowStart: 480,
        address,
        notes: "",
      }),
    );
    expect(paused.code).toBe("PRECONDITION_FAILED");

    expect((await trpcError(call(crew).payouts.start({ businessId }))).code).toBe("FORBIDDEN");
    const { url } = await call(owner).payouts.start({ businessId });
    const accountId = new URL(url).searchParams.get("account") ?? "";
    await handlePaymentEvent(deps(), harness.payments.finishOnboarding(accountId));
    expect((await call(owner).payouts.refresh({ businessId })).payoutsEnabled).toBe(true);

    await runScheduledJobs(deps());
    const [payout] = await harness.db
      .select()
      .from(payouts)
      .where(eq(payouts.businessId, businessId));
    // $60 − 3% = $58.20 (not GST/HST-registered, so no tax on the price).
    expect(payout).toMatchObject({ amountCents: 5820, status: "paid", periodEnd: "2026-11-09" });
    expect(
      harness.payments.ledger().transfers.filter((transfer) => transfer.accountId === accountId),
    ).toHaveLength(1);
    // Running again pays nothing twice.
    await runScheduledJobs(deps());
    expect(
      harness.payments.ledger().transfers.filter((transfer) => transfer.accountId === accountId),
    ).toHaveLength(1);
    expect((await call(owner).payouts.status({ businessId })).bookingsPaused).toBe(false);
  });

  it("holds the card for approval requests until the business answers", async () => {
    harness.clock.set(novAt(9, 10));
    await call(owner).listing.updateProfile({
      businessId,
      name: "Bedford Big Yards",
      description: ABOUT,
      gstHstNumber: "",
      cancellationPolicy: "flexible",
      instantBook: false,
    });
    const accepted = await book(customer, { date: "2026-11-12", windowStart: 480 });
    expect(accepted.status).toBe("requested");
    let [payment] = await harness.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, accepted.bookingId));
    expect(payment?.status).toBe("authorized");
    expect(
      (
        await trpcError(
          call(crew).businessBookings.accept({ businessId, bookingId: accepted.bookingId }),
        )
      ).code,
    ).toBe("FORBIDDEN");
    const inbox = await call(owner).businessBookings.inbox({ businessId });
    expect(inbox.requests.map((request) => request.id)).toContain(accepted.bookingId);
    await call(owner).businessBookings.accept({ businessId, bookingId: accepted.bookingId });
    [payment] = await harness.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, accepted.bookingId));
    expect(payment?.status).toBe("succeeded");
    expect((await call(customer).bookings.get({ bookingId: accepted.bookingId })).status).toBe(
      "confirmed",
    );

    const declined = await book(customer, { date: "2026-11-12", windowStart: 660 });
    await call(owner).businessBookings.decline({ businessId, bookingId: declined.bookingId });
    [payment] = await harness.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, declined.bookingId));
    expect(payment?.status).toBe("cancelled");

    const lapsed = await book(other, { date: "2026-11-13", windowStart: 480 });
    harness.clock.set(novAt(10, 10, 1));
    await runScheduledJobs(deps());
    expect((await call(other).bookings.get({ bookingId: lapsed.bookingId })).status).toBe(
      "expired",
    );
  });

  it("refunds by the cancellation policy, or in full when the business cancels", async () => {
    harness.clock.set(novAt(10, 12));
    await call(owner).listing.updateProfile({
      businessId,
      name: "Bedford Big Yards",
      description: ABOUT,
      gstHstNumber: "",
      cancellationPolicy: "flexible",
      instantBook: true,
    });
    const early = await book(customer, { date: "2026-11-16", windowStart: 840 });
    const quote = (await call(customer).bookings.get({ bookingId: early.bookingId })).cancelQuote;
    expect(quote).toMatchObject({ free: true, refundCents: 6000 });
    await call(customer).bookings.cancel({ bookingId: early.bookingId });
    const [refund] = await harness.db
      .select()
      .from(refunds)
      .innerJoin(payments, eq(payments.id, refunds.paymentId))
      .where(eq(payments.bookingId, early.bookingId));
    // The job price comes back; the service fee and its HST stay (SPEC §5).
    expect(refund?.refunds).toMatchObject({
      amountCents: 6000,
      serviceFeeCents: 0,
      reason: "customer_cancellation",
    });
    expect(refund?.payments.status).toBe("partially_refunded");

    const byBusiness = await book(customer, { date: "2026-11-16", windowStart: 480 });
    await call(owner).businessBookings.cancel({
      businessId,
      bookingId: byBusiness.bookingId,
      reason: "Mower broke down",
    });
    const [full] = await harness.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, byBusiness.bookingId));
    expect(full?.status).toBe("refunded");
    expect(
      (await call(customer).bookings.get({ bookingId: byBusiness.bookingId })).statusLabel,
    ).toBe("Cancelled by the pro");
  });

  it("only offers fixed-price services that are on show", async () => {
    await harness.db.update(services).set({ active: false }).where(eq(services.id, serviceId));
    const hidden = await trpcError(call(harness.anonymous()).bookings.availability({ serviceId }));
    expect(hidden.code).toBe("NOT_FOUND");
    await harness.db.update(services).set({ active: true }).where(eq(services.id, serviceId));
  });

  it("cancels upcoming bookings with a full refund when payout setup isn't finished in 7 days", async () => {
    harness.clock.set(novAt(10, 12));
    const lateOwner = (await harness.signUp("lou@example.com", "Lou Late")).ctx;
    const late = await call(lateOwner).business.create({ name: "Late Lawns", province: "NS" });
    await call(lateOwner).listing.updateProfile({
      businessId: late.id,
      name: "Late Lawns",
      description: ABOUT,
      gstHstNumber: "",
      cancellationPolicy: "strict",
      instantBook: true,
    });
    await call(lateOwner).listing.setServiceArea({
      businessId: late.id,
      center: BEDFORD,
      radiusKm: 25,
    });
    const lateService = (
      await call(lateOwner).listing.createService({ businessId: late.id, ...mowing })
    ).id;
    await call(lateOwner).listing.publish({ businessId: late.id });

    const upcoming = await book(customer, {
      date: "2026-11-30",
      windowStart: 480,
      service: lateService,
    });
    harness.clock.set(novAt(15, 12));
    harness.emails.length = 0;
    await runScheduledJobs(deps());
    expect(harness.emails.map((message) => message.subject)).toContain(
      "Reminder: finish payout setup",
    );

    harness.clock.set(novAt(17, 12, 1));
    await runScheduledJobs(deps());
    const view = await call(customer).bookings.get({ bookingId: upcoming.bookingId });
    expect(view.status).toBe("cancelled_by_business");
    // Everything back, service fee included, even under a Strict policy.
    expect(view.amounts.refundedCents).toBe(view.amounts.totalCents);
    expect(harness.emails.map((message) => message.subject)).toContain(
      "Bookings paused: payout setup not finished",
    );
    const blocked = await trpcError(
      call(customer).bookings.checkout({
        serviceId: lateService,
        date: "2026-12-01",
        windowStart: 480,
        address,
        notes: "",
      }),
    );
    expect(blocked.code).toBe("PRECONDITION_FAILED");
  });

  it("uses the business's own windows, hours and time off", async () => {
    harness.clock.set(novAt(17, 12));
    await call(owner).team.updateSettings({
      businessId,
      minNoticeDays: 2,
      maxDaysAhead: 30,
      windows: [
        { startMinute: 420, endMinute: 600 },
        { startMinute: 780, endMinute: 960 },
      ],
    });
    const bad = await trpcError(
      call(owner).team.updateSettings({
        businessId,
        minNoticeDays: 1,
        maxDaysAhead: 30,
        windows: [
          { startMinute: 420, endMinute: 600 },
          { startMinute: 540, endMinute: 720 },
        ],
      }),
    );
    expect(bad.code).toBe("BAD_REQUEST");
    const team = await call(owner).team.members({ businessId });
    const ownerMember = team.find((row) => row.name === "Bea Owner");
    // Only the owner works Mondays now; the crew member is off all day.
    await call(owner).team.setHours({ businessId, memberId: crewMemberId, hours: [] });
    await call(owner).team.addTimeOff({
      businessId,
      memberId: ownerMember?.id ?? "",
      startsAt: novAt(23, 7),
      endsAt: novAt(23, 10),
    });
    const view = await call(harness.anonymous()).bookings.availability({
      serviceId,
      from: "2026-11-23",
      days: 1,
    });
    expect(view.firstDate).toBe("2026-11-19");
    expect(view.days[0]?.windows.map((window) => [window.label, window.available])).toEqual([
      ["7–10 am", false],
      ["1–4 pm", true],
    ]);
    expect(
      (
        await trpcError(
          call(crew).team.setHours({ businessId, memberId: ownerMember?.id ?? "", hours: [] }),
        )
      ).code,
    ).toBe("FORBIDDEN");
  });
});
