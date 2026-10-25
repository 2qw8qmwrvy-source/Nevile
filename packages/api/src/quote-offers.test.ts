import type { LatLng, ServiceInput } from "@nevile/core";
import {
  asc,
  bookings,
  businesses,
  contractPeriods,
  conversations,
  eq,
  payments,
  quotes,
  visits,
} from "@nevile/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Context } from "./context.ts";
import { createCaller } from "./root.ts";
import { createHarness, type Harness, trpcError } from "./test/harness.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const ABOUT = "Lawns in summer, driveways in winter: Halifax's year-round yard crew.";
const BEDFORD: LatLng = { lat: 44.7316, lng: -63.6545 };
/** Halifax wall-clock time in November 2026 (AST, UTC−4). */
const novAt = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 10, day, hour + 4, minute));
const service = (categorySlug: string, title: string): ServiceInput => ({
  categorySlug: categorySlug as ServiceInput["categorySlug"],
  title,
  description: "",
  pricingType: "quote",
  priceCents: null,
  fromPriceCents: 5000,
  durationMinutes: 60,
  instantBook: false,
  active: true,
  recurrenceFrequencies: [],
});
const address = { line1: "9 Quote Street", line2: "", city: "Halifax", postalCode: "B3H 4R2" };
const details = "Front and back lawn, about 400 square metres, needs regular mowing.";

describe.skipIf(!TEST_DATABASE_URL)("recurring and snow contract quotes (SPEC §21)", () => {
  let harness: Harness;
  let owner: Context;
  let cora: Context;
  let businessId = "";

  const call = (ctx: Context) => createCaller(ctx);

  async function saveCard(ctx: Context) {
    const setup = await call(ctx).cards.startSetup({ kind: "intent" });
    await call(ctx).cards.payTestSetup({ setupId: setup.setupId });
  }

  /** Cora asks for a quote; Fern's Yards replies with `reply`. Returns the quote id. */
  async function quoteFor(
    categorySlug: "lawn-mowing" | "snow-ice-removal",
    reply: Omit<
      Parameters<ReturnType<typeof call>["businessQuotes"]["reply"]>[0],
      "businessId" | "requestId"
    >,
  ) {
    const { groupId } = await call(cora).quotes.request({
      categorySlug,
      businessIds: [businessId],
      details,
      postalCode: "B3H 1A1",
      timing: "flexible",
    });
    const request = (await call(owner).businessQuotes.list({ businessId })).needsReply[0];
    await call(owner).businessQuotes.reply({ ...reply, businessId, requestId: request?.id ?? "" });
    const pro = (await call(cora).quotes.get({ groupId })).pros[0];
    return { groupId, quote: pro?.quote, requestId: request?.id ?? "" };
  }

  beforeAll(async () => {
    harness = await createHarness(TEST_DATABASE_URL as string);
    harness.clock.set(novAt(2, 9));
    owner = (await harness.signUp("fern@example.com", "Fern Owner")).ctx;
    businessId = (await call(owner).business.create({ name: "Fern's Yards", province: "NS" })).id;
    await call(owner).listing.updateProfile({
      businessId,
      name: "Fern's Yards",
      description: ABOUT,
      gstHstNumber: "",
      cancellationPolicy: "flexible",
      instantBook: false,
    });
    await call(owner).listing.setServiceArea({ businessId, center: BEDFORD, radiusKm: 25 });
    await call(owner).listing.createService({
      businessId,
      ...service("lawn-mowing", "Lawn care"),
    });
    await call(owner).listing.createService({
      businessId,
      ...service("snow-ice-removal", "Snow clearing"),
    });
    await call(owner).listing.publish({ businessId });
    await harness.db
      .update(businesses)
      .set({ payoutsEnabled: true, stripeAccountId: "acct_test_fern" })
      .where(eq(businesses.id, businessId));
    cora = (await harness.signUp("cora@example.com", "Cora Customer")).ctx;
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("a recurring offer is booked on one of its schedules and confirmed at once", async () => {
    const { quote, requestId } = await quoteFor("lawn-mowing", {
      kind: "recurring",
      priceCents: 5500,
      durationMinutes: 60,
      frequencies: ["weekly"],
      note: "Every Tuesday morning suits us.",
    });
    expect(quote).toMatchObject({
      kind: "recurring",
      summary: "$55.00 per visit, every week",
      frequencies: [{ value: "weekly", label: "Every week" }],
      contract: null,
    });
    const quoteId = quote?.id ?? "";
    expect(lastSubject("cora@example.com")).toBe("Quote from Fern's Yards: $55.00");

    // It isn't a one-off job, and only the schedules offered can be picked.
    const oneOff = await trpcError(
      call(cora).quotes.checkout({
        quoteId,
        date: "2026-11-03",
        windowStart: 480,
        address,
        notes: "",
      }),
    );
    expect(oneOff.message).toBe("This quote is for recurring visits: pick a schedule to book it.");
    const schedule = {
      quoteId,
      frequency: "weekly" as const,
      date: "2026-11-03",
      windowStart: 480,
      endDate: "2026-11-24",
      overrides: [],
    };
    const biweekly = await trpcError(
      call(cora).recurring.previewQuote({ ...schedule, frequency: "biweekly" }),
    );
    expect(biweekly.code).toBe("BAD_REQUEST");
    const preview = await call(cora).recurring.previewQuote(schedule);
    expect(preview).toMatchObject({ visits: 4, problem: null });
    expect(preview.price.priceCents).toBe(5500);

    // The address must be where the quote was asked for.
    await saveCard(cora);
    const elsewhere = await trpcError(
      call(cora).recurring.requestFromQuote({
        ...schedule,
        address: { ...address, postalCode: "B4A 1A1" },
        notes: "",
      }),
    );
    expect(elsewhere.message).toContain("The quote is for B3H");

    const booked = await call(cora).recurring.requestFromQuote({ ...schedule, address, notes: "" });
    expect(booked.status).toBe("confirmed");
    const [booking] = await harness.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, booked.bookingId));
    expect(booking).toMatchObject({
      kind: "recurring",
      status: "confirmed",
      quoteId,
      title: "Lawn Mowing (quoted)",
      priceCents: 5500,
    });
    const placed = await harness.db
      .select()
      .from(visits)
      .where(eq(visits.bookingId, booked.bookingId))
      .orderBy(asc(visits.sequence));
    expect(placed).toHaveLength(4);
    expect(placed[0]?.workMinutes).toBe(60);
    // The quote is accepted and its chat follows the booking.
    const [accepted] = await harness.db.select().from(quotes).where(eq(quotes.id, quoteId));
    expect(accepted?.status).toBe("accepted");
    const [chat] = await harness.db
      .select()
      .from(conversations)
      .where(eq(conversations.quoteRequestId, requestId));
    expect(chat?.bookingId).toBe(booked.bookingId);
    expect(lastSubject("cora@example.com")).toBe("Booked: Lawn Mowing (quoted) with Fern's Yards");
    expect(lastSubject("fern@example.com")).toMatch(/^Booked: your recurring offer/);
  });

  it("snow contract terms are only for snow requests", async () => {
    const contract = {
      triggerCm: 5,
      seasonStart: "2026-11-15",
      seasonEnd: "2027-03-31",
      pricing: "season" as const,
      seasonBilling: "monthly" as const,
    };
    const { groupId } = await call(cora).quotes.request({
      categorySlug: "lawn-mowing",
      businessIds: [businessId],
      details,
      postalCode: "B3H 1A1",
      timing: "flexible",
    });
    const request = (await call(owner).businessQuotes.list({ businessId })).needsReply[0];
    const wrong = await trpcError(
      call(owner).businessQuotes.reply({
        businessId,
        requestId: request?.id ?? "",
        kind: "snow_contract",
        priceCents: 60_000,
        contract,
        note: "",
      }),
    );
    expect(wrong.message).toBe("Snow contract terms are for Snow & Ice Removal requests.");
    await call(cora).quotes.close({ groupId });
  });

  it("snow contract terms in a quote are signed up for and confirmed at once", async () => {
    const { quote } = await quoteFor("snow-ice-removal", {
      kind: "snow_contract",
      priceCents: 60_000,
      contract: {
        triggerCm: 5,
        seasonStart: "2026-11-15",
        seasonEnd: "2027-03-31",
        pricing: "season",
        seasonBilling: "monthly",
      },
      note: "Driveway and walk, salted.",
    });
    expect(quote).toMatchObject({
      kind: "snow_contract",
      summary: "$600.00 for the season (November 15, 2026 to March 31, 2027), clearing from 5 cm",
      contract: { pricing: "season", seasonBilling: "monthly", triggerCm: 5 },
    });
    const quoteId = quote?.id ?? "";
    const offer = await call(cora).snow.quoteOffer({ quoteId });
    expect(offer).toMatchObject({
      quoteId,
      spotsLeft: null,
      open: true,
      seasonPayment: "monthly",
      service: { title: "Snow & Ice Removal (quoted)", description: "Driveway and walk, salted." },
    });
    expect(offer.instalments).toHaveLength(5);
    const missingAgreement = await trpcError(
      call(cora).snow.signUpFromQuote({
        quoteId,
        address,
        notes: "",
        seasonPayment: null,
        agreed: false as unknown as true,
      }),
    );
    expect(missingAgreement.code).toBe("BAD_REQUEST");

    const signed = await call(cora).snow.signUpFromQuote({
      quoteId,
      address,
      notes: "",
      seasonPayment: null,
      agreed: true,
    });
    expect(signed.status).toBe("confirmed");
    const periods = await harness.db
      .select()
      .from(contractPeriods)
      .where(eq(contractPeriods.bookingId, signed.bookingId))
      .orderBy(asc(contractPeriods.sequence));
    expect(periods.map((period) => period.status)).toEqual([
      "charged",
      "scheduled",
      "scheduled",
      "scheduled",
      "scheduled",
    ]);
    expect(
      await harness.db.select().from(payments).where(eq(payments.bookingId, signed.bookingId)),
    ).toMatchObject([{ status: "succeeded" }]);
    // Both get the signed agreement.
    const booked = harness.emails.findLast((message) => message.to === "cora@example.com");
    expect(booked?.subject).toBe("Booked: Snow & Ice Removal (quoted) with Fern's Yards");
    expect(booked?.attachments).toHaveLength(1);
    expect(
      harness.emails.findLast((message) => message.to === "fern@example.com")?.attachments,
    ).toHaveLength(1);
    const route = await call(owner).businessBookings.snowRoute({ businessId });
    expect(route.stops.map((stop) => stop.bookingId)).toEqual([signed.bookingId]);
  });

  function lastSubject(to: string): string | undefined {
    return harness.emails.findLast((message) => message.to === to)?.subject;
  }
});
