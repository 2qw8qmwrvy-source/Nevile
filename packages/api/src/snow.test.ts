import { createHash } from "node:crypto";
import { calculateCharge, type LatLng, type ServiceInput, seasonEndActions } from "@nevile/core";
import {
  agreements,
  asc,
  bookings,
  businesses,
  contractPeriods,
  eq,
  notifications,
  payments,
} from "@nevile/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runScheduledJobs } from "./bookings/jobs.ts";
import type { Context } from "./context.ts";
import { agreementFileFor, visitPhotoKeyFor } from "./ongoing/snow.ts";
import { savePrivatePhoto } from "./photos.ts";
import { createCaller } from "./root.ts";
import { createHarness, type Harness, trpcError } from "./test/harness.ts";
import { errorReasonOf } from "./trpc.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const ABOUT = "Plowing and shovelling crews keeping Halifax driveways clear since 2012.";
const BEDFORD: LatLng = { lat: 44.7316, lng: -63.6545 };
/** Halifax wall-clock time (AST, UTC−4, all season). Month is 1–12. */
const at = (year: number, month: number, day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(year, month - 1, day, hour + 4, minute));
const driveway: ServiceInput = {
  categorySlug: "snow-ice-removal",
  title: "Driveway clearing",
  description: "Driveway and front walk, salted.",
  pricingType: "fixed",
  priceCents: 4000,
  fromPriceCents: null,
  durationMinutes: 30,
  instantBook: true,
  active: true,
  recurrenceFrequencies: [],
};
const season = { triggerCm: 5, seasonStart: "2026-11-15", seasonEnd: "2027-03-31" };
const address = { line1: "40 Snowy Lane", line2: "", city: "Halifax", postalCode: "B3H 4R2" };
/** A 1×1 PNG; it is re-encoded as WebP like any photo. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

describe.skipIf(!TEST_DATABASE_URL)("snow contracts (SPEC §21)", () => {
  let harness: Harness;
  let owner: Context;
  let ownerUserId = "";
  let businessId = "";
  let seasonServiceId = "";
  let perVisitServiceId = "";
  let slug = "";
  const people: Record<string, { ctx: Context; userId: string; bookingId: string }> = {};

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
  const noticesFor = (userId: string, type: string) =>
    harness.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .then((rows) => rows.filter((row) => row.type === type));
  const lastEmail = (to: string, subject: RegExp) =>
    harness.emails.findLast((message) => message.to === to && subject.test(message.subject));
  const periodsOf = (bookingId: string) =>
    harness.db
      .select()
      .from(contractPeriods)
      .where(eq(contractPeriods.bookingId, bookingId))
      .orderBy(asc(contractPeriods.sequence));
  const paymentsOf = (bookingId: string) =>
    harness.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, bookingId))
      .orderBy(asc(payments.createdAt));
  const monthTotal = (priceCents: number) =>
    calculateCharge({ priceCents, province: "NS", businessTaxRegistered: false }).totalCents;

  async function saveCard(ctx: Context, declining = false) {
    const setup = await call(ctx).cards.startSetup({ kind: "intent" });
    await call(ctx).cards.payTestSetup({ setupId: setup.setupId, declining });
  }

  async function customer(name: string, options: { declining?: boolean; card?: boolean } = {}) {
    const email = `${name.toLowerCase()}@example.com`;
    const signedUp = await harness.signUp(email, `${name} Customer`);
    if (options.card ?? true) await saveCard(signedUp.ctx, options.declining);
    people[name] = { ctx: signedUp.ctx, userId: signedUp.userId, bookingId: "" };
    return signedUp.ctx;
  }

  async function signUp(
    name: string,
    serviceId: string,
    seasonPayment: "upfront" | "monthly" | null,
  ) {
    const person = people[name];
    if (!person) throw new Error(`no customer ${name}`);
    const { bookingId } = await call(person.ctx).snow.signUp({
      serviceId,
      address,
      notes: "Car is in the driveway overnight.",
      seasonPayment,
      agreed: true,
    });
    person.bookingId = bookingId;
    return bookingId;
  }

  beforeAll(async () => {
    harness = await createHarness(TEST_DATABASE_URL as string);
    harness.clock.set(at(2026, 11, 2, 9));
    const signedUp = await harness.signUp("bea@example.com", "Bea Owner");
    owner = signedUp.ctx;
    ownerUserId = signedUp.userId;
    businessId = (await call(owner).business.create({ name: "Bea's Plowing", province: "NS" })).id;
    await call(owner).listing.updateProfile({
      businessId,
      name: "Bea's Plowing",
      description: ABOUT,
      gstHstNumber: "",
      cancellationPolicy: "flexible",
      instantBook: true,
    });
    await call(owner).listing.setServiceArea({ businessId, center: BEDFORD, radiusKm: 25 });
    seasonServiceId = (await call(owner).listing.createService({ businessId, ...driveway })).id;
    perVisitServiceId = (
      await call(owner).listing.createService({
        businessId,
        ...driveway,
        title: "Clear after each storm",
      })
    ).id;
    await call(owner).listing.publish({ businessId });
    await harness.db
      .update(businesses)
      .set({ payoutsEnabled: true, stripeAccountId: "acct_test_bea" })
      .where(eq(businesses.id, businessId));
    const [row] = await harness.db
      .select({ slug: businesses.slug })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    slug = row?.slug ?? "";
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("lists a snow service as a seasonal contract with spots", async () => {
    const lawn = await call(owner).listing.createService({
      businessId,
      ...driveway,
      categorySlug: "lawn-mowing",
      title: "Mowing",
    });
    const wrongCategory = await trpcError(
      call(owner).listing.setContractTerms({
        businessId,
        serviceId: lawn.id,
        terms: { ...season, pricing: "per_visit", priceCents: 4500, seasonBilling: null, spots: 5 },
      }),
    );
    expect(wrongCategory.message).toBe("Seasonal contracts are for Snow & Ice Removal services.");
    await call(owner).listing.deleteService({ businessId, serviceId: lawn.id });

    await call(owner).listing.setContractTerms({
      businessId,
      serviceId: seasonServiceId,
      terms: { ...season, pricing: "season", priceCents: 60000, seasonBilling: "either", spots: 2 },
    });
    await call(owner).listing.setContractTerms({
      businessId,
      serviceId: perVisitServiceId,
      terms: { ...season, pricing: "per_visit", priceCents: 4500, seasonBilling: null, spots: 5 },
    });

    const profile = await call(harness.anonymous()).search.profile({ slug });
    const listed = profile.services.find((service) => service.id === seasonServiceId);
    expect(listed).toMatchObject({
      bookable: false,
      contract: { triggerCm: 5, pricing: "season", priceCents: 60000, spots: 2, spotsLeft: 2 },
    });
    // A contract is signed up for, not booked as a one-off.
    const oneOff = await trpcError(
      call(harness.anonymous()).bookings.availability({ serviceId: seasonServiceId, days: 7 }),
    );
    expect(oneOff.message).toBe("This is a seasonal contract: sign up for it from the pro's page.");

    const offer = await call(harness.anonymous()).snow.offer({
      serviceId: seasonServiceId,
      seasonPayment: "monthly",
    });
    expect(offer).toMatchObject({
      terms: { season: "November 15, 2026 to March 31, 2027", triggerCm: 5 },
      spotsLeft: 2,
      open: true,
      seasonPayment: "monthly",
      card: null,
    });
    // The season splits evenly over its 5 months ($120 each); November is a part month.
    expect(offer.instalments).toEqual([
      {
        label: "November 15–30, 2026",
        totalCents: monthTotal(12000),
        charged: "when the pro accepts",
      },
      { label: "December 2026", totalCents: monthTotal(12000), charged: "December 1" },
      { label: "January 2027", totalCents: monthTotal(12000), charged: "January 1" },
      { label: "February 2027", totalCents: monthTotal(12000), charged: "February 1" },
      { label: "March 2027", totalCents: monthTotal(12000), charged: "March 1" },
    ]);
    expect(offer.price?.totalCents).toBe(5 * monthTotal(12000));
    expect(offer.agreement.map((section) => section.heading)).toContain("Ending the contract");
  });

  it("signs up with the agreement (PDF copy); spots are limited", async () => {
    const amy = await customer("Amy", { card: false });
    const noCard = await trpcError(
      call(amy).snow.signUp({
        serviceId: seasonServiceId,
        address,
        notes: "",
        seasonPayment: "monthly",
        agreed: true,
      }),
    );
    expect(errorReasonOf(noCard)).toBe("CARD_REQUIRED");
    await saveCard(amy);
    const unchosen = await trpcError(signUp("Amy", seasonServiceId, null));
    expect(unchosen.message).toBe("Choose to pay upfront or monthly.");

    const bookingId = await signUp("Amy", seasonServiceId, "monthly");
    const view = await call(amy).bookings.get({ bookingId });
    expect(view).toMatchObject({
      kind: "snow_contract",
      status: "requested",
      ongoing: {
        kind: "snow_contract",
        pricing: "season",
        season: { payment: "monthly", months: [] },
        agreement: { path: `/api/agreements/${bookingId}` },
      },
    });
    // Both sides get the agreement she agreed to; its hash is on record.
    const mail = lastEmail("amy@example.com", /^Sign-up sent to Bea's Plowing/);
    const pdf = mail?.attachments?.[0]?.content ?? new Uint8Array();
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    const [agreement] = await harness.db
      .select()
      .from(agreements)
      .where(eq(agreements.bookingId, bookingId));
    expect(agreement?.contentSha256).toBe(createHash("sha256").update(pdf).digest("hex"));
    expect(lastEmail("bea@example.com", /^Snow contract sign-up/)?.attachments).toHaveLength(1);
    expect(await agreementFileFor(harness.db, people.Amy?.userId ?? "", bookingId)).toBe(
      agreement?.pdfStorageKey,
    );
    expect(await agreementFileFor(harness.db, ownerUserId, bookingId)).toBe(
      agreement?.pdfStorageKey,
    );

    // One per customer; then spots run out (requests hold a spot).
    expect((await trpcError(signUp("Amy", seasonServiceId, "monthly"))).code).toBe("CONFLICT");
    await customer("Ben");
    await signUp("Ben", seasonServiceId, "upfront");
    const cal = await customer("Cal");
    expect(await agreementFileFor(harness.db, people.Cal?.userId ?? "", bookingId)).toBeNull();
    const full = await trpcError(signUp("Cal", seasonServiceId, "monthly"));
    expect(full.message).toBe("No spots left on this contract.");
    expect((await call(cal).snow.offer({ serviceId: seasonServiceId })).open).toBe(false);
  });

  it("accepting schedules the months and charges what's due now", async () => {
    harness.clock.set(at(2026, 11, 2, 10));
    const amy = people.Amy?.bookingId ?? "";
    const ben = people.Ben?.bookingId ?? "";
    await call(owner).businessBookings.accept({ businessId, bookingId: amy });
    const periods = await periodsOf(amy);
    expect(periods.map((period) => [period.periodStart, period.status])).toEqual([
      ["2026-11-15", "charged"],
      ["2026-12-01", "scheduled"],
      ["2027-01-01", "scheduled"],
      ["2027-02-01", "scheduled"],
      ["2027-03-01", "scheduled"],
    ]);
    expect(periods[1]?.chargeDueAt).toEqual(at(2026, 12, 1, 9));
    expect(periods[0]?.releaseAt).toEqual(at(2026, 12, 1, 0));
    expect(await paymentsOf(amy)).toMatchObject([
      { status: "succeeded", amountCents: monthTotal(12000), releasedAt: null },
    ]);

    // Upfront: one charge for the whole season, recorded month by month.
    await call(owner).businessBookings.accept({ businessId, bookingId: ben });
    const benPayments = await paymentsOf(ben);
    expect(benPayments).toHaveLength(5);
    expect(new Set(benPayments.map((payment) => payment.stripePaymentIntentId)).size).toBe(1);
    expect(benPayments.every((payment) => payment.status === "succeeded")).toBe(true);
    expect(lastEmail("ben@example.com", /^Accepted:/)?.attachments).toHaveLength(1);

    const page = await call(owner).businessBookings.ongoing({ businessId, bookingId: ben });
    expect(page.ongoing).toMatchObject({
      kind: "snow_contract",
      season: { paymentLabel: "Paid upfront" },
    });
    expect(
      page.ongoing.kind === "snow_contract" &&
        page.ongoing.season?.months.map((month) => month.state),
    ).toEqual(["charged", "charged", "charged", "charged", "charged"]);

    // Both are on the route in the order they were accepted; the season hasn't started.
    const route = await call(owner).businessBookings.snowRoute({ businessId });
    expect(route.stops.map((stop) => [stop.bookingId, stop.canMark])).toEqual([
      [amy, false],
      [ben, false],
    ]);
  });

  it("the snow route logs visits; season months are paid out after they end", async () => {
    const amy = people.Amy?.bookingId ?? "";
    const ben = people.Ben?.bookingId ?? "";
    harness.clock.set(at(2026, 11, 20, 7));
    await call(owner).businessBookings.reorderRoute({ businessId, bookingIds: [ben, amy] });
    expect(
      (await call(owner).businessBookings.snowRoute({ businessId })).stops.map(
        (stop) => stop.bookingId,
      ),
    ).toEqual([ben, amy]);

    const { visitId } = await call(owner).businessBookings.markCleared({
      businessId,
      bookingId: amy,
    });
    const again = await trpcError(
      call(owner).businessBookings.markCleared({ businessId, bookingId: amy }),
    );
    expect(again.message).toBe("This address was marked cleared a few minutes ago.");
    expect(await noticesFor(people.Amy?.userId ?? "", "visit.logged")).toHaveLength(1);
    const view = await call(people.Amy?.ctx as Context).bookings.get({ bookingId: amy });
    expect(view.needsAttention).toBe(true);
    expect(view.ongoing?.visits[0]).toMatchObject({
      id: visitId,
      status: "completed_pending_confirmation",
      actions: { confirmDone: true, reportProblem: true },
    });
    expect(view.ongoing?.visits[0]?.window.label).toMatch(/^Cleared Friday, November 20 at 7:00/);

    // Confirming a season visit charges nothing more.
    await call(people.Amy?.ctx as Context).bookings.confirmDone({ bookingId: amy, visitId });
    expect(await paymentsOf(amy)).toHaveLength(1);

    // November's share goes to the business once November is over; December is charged
    // on the 1st at 9 am.
    harness.clock.set(at(2026, 12, 1, 0, 5));
    await jobs();
    const [november] = await paymentsOf(amy);
    expect(november?.releasedAt).toEqual(at(2026, 12, 1, 0));
    harness.clock.set(at(2026, 12, 1, 9, 5));
    await jobs();
    expect((await paymentsOf(amy)).map((payment) => payment.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
  });

  it("a per-visit contract charges each visit once it's confirmed", async () => {
    harness.clock.set(at(2026, 12, 1, 10));
    await customer("Dot");
    const dot = await signUp("Dot", perVisitServiceId, null);
    await call(owner).businessBookings.accept({ businessId, bookingId: dot });
    expect(await paymentsOf(dot)).toEqual([]);

    harness.clock.set(at(2026, 12, 2, 7));
    const photo = await savePrivatePhoto({
      db: harness.db,
      storage: harness.storage,
      session: owner.session,
      purpose: "visits",
      bytes: new Uint8Array(PNG),
    });
    if (!photo.ok) throw new Error(photo.message);
    const { visitId } = await call(owner).businessBookings.markCleared({
      businessId,
      bookingId: dot,
      photoIds: [photo.id],
    });
    const view = await call(people.Dot?.ctx as Context).bookings.get({ bookingId: dot });
    const photoId = view.ongoing?.visits[0]?.photos[0]?.id ?? "";
    expect(view.ongoing?.visits[0]?.photos).toEqual([
      { id: photoId, url: `/api/visit-photos/${photoId}` },
    ]);
    expect(await visitPhotoKeyFor(harness.db, people.Dot?.userId ?? "", photoId)).toMatch(
      /^private\/visits\//,
    );
    expect(await visitPhotoKeyFor(harness.db, people.Cal?.userId ?? "", photoId)).toBeNull();

    // Nobody answers: it confirms itself after 48 hours, is charged and paid out Monday.
    harness.clock.set(at(2026, 12, 4, 7, 5));
    await jobs();
    expect(await paymentsOf(dot)).toMatchObject([
      {
        visitId,
        status: "succeeded",
        amountCents: monthTotal(4500),
        releasedAt: at(2026, 12, 4, 7, 5),
      },
    ]);
  });

  it("ending a season contract: the customer keeps this month, the pro refunds the rest", async () => {
    harness.clock.set(at(2026, 12, 10, 12));
    const amy = people.Amy?.bookingId ?? "";
    const ben = people.Ben?.bookingId ?? "";
    const ended = await call(people.Amy?.ctx as Context).bookings.cancel({ bookingId: amy });
    expect(ended.status).toBe("completed");
    expect((await periodsOf(amy)).map((period) => period.status)).toEqual([
      "charged",
      "charged",
      "cancelled",
      "cancelled",
      "cancelled",
    ]);
    expect(lastEmail("bea@example.com", /^Ended by the customer/)).toBeDefined();

    // Bea ends Ben's upfront contract: the rest of December day by day, later months in full.
    const before = await paymentsOf(ben);
    const expected = seasonEndActions({
      by: "business",
      endedOn: "2026-12-10",
      periods: (await periodsOf(ben)).map((period, index) => ({
        sequence: period.sequence,
        start: period.periodStart,
        end: period.periodEnd,
        days: index === 0 ? 16 : ([31, 31, 28, 31][index - 1] ?? 30),
        paid: {
          priceCents: before[index]?.priceCents ?? 0,
          serviceFeeCents: before[index]?.serviceFeeCents ?? 0,
          taxOnPriceCents: before[index]?.priceTaxCents ?? 0,
          taxOnFeeCents: before[index]?.feeTaxCents ?? 0,
        },
      })),
    }).reduce(
      (sum, action) => sum + (action.action === "refund" ? action.refund.totalRefundCents : 0),
      0,
    );
    const result = await call(owner).businessBookings.endOngoing({
      businessId,
      bookingId: ben,
      reason: "Our plow truck was written off.",
    });
    expect(result.refundCents).toBe(expected);
    expect((await paymentsOf(ben)).map((payment) => payment.status)).toEqual([
      "succeeded",
      "partially_refunded",
      "refunded",
      "refunded",
      "refunded",
    ]);
    expect(lastEmail("ben@example.com", /^Ended:/)?.text).toContain(
      "Our plow truck was written off.",
    );
  });

  it("a declined card pauses the contract and keeps it off the route until a new card pays", async () => {
    harness.clock.set(at(2026, 12, 10, 13));
    await customer("Eve", { declining: true });
    const eve = await signUp("Eve", seasonServiceId, "monthly");
    harness.clock.set(at(2026, 12, 10, 13, 5));
    await call(owner).businessBookings.accept({ businessId, bookingId: eve });
    expect(await paymentsOf(eve)).toMatchObject([{ status: "failed" }]);
    expect(await noticesFor(people.Eve?.userId ?? "", "payment.failed")).toHaveLength(1);

    // Retried daily for 3 days, then paused.
    for (const day of [11, 12, 13, 14]) {
      harness.clock.set(at(2026, 12, day, 13, 10));
      await jobs();
    }
    expect(await paymentsOf(eve)).toHaveLength(4);
    const [paused] = await harness.db.select().from(bookings).where(eq(bookings.id, eve));
    expect(paused?.pausedAt).toEqual(at(2026, 12, 14, 13, 10));
    const stop = (await call(owner).businessBookings.snowRoute({ businessId })).stops.find(
      (candidate) => candidate.bookingId === eve,
    );
    expect(stop).toMatchObject({ paused: true, canMark: false });
    const refused = await trpcError(
      call(owner).businessBookings.markCleared({ businessId, bookingId: eve }),
    );
    expect(refused.code).toBe("CONFLICT");

    // A working card pays what's owed at once and resumes the contract.
    await saveCard(people.Eve?.ctx as Context);
    expect((await paymentsOf(eve)).at(-1)?.status).toBe("succeeded");
    const [resumed] = await harness.db.select().from(bookings).where(eq(bookings.id, eve));
    expect(resumed?.pausedAt).toBeNull();
  });

  it("contracts end by themselves after the season", async () => {
    harness.clock.set(at(2027, 4, 1, 1));
    await jobs();
    const rows = await harness.db
      .select({ id: bookings.id, status: bookings.status })
      .from(bookings)
      .where(eq(bookings.businessId, businessId));
    expect(rows.filter((row) => row.status === "confirmed")).toEqual([]);
    expect(rows.find((row) => row.id === people.Dot?.bookingId)?.status).toBe("completed");
  });
});
