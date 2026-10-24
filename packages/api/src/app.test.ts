import type { LatLng, ServiceInput } from "@nevile/core";
import { bookingCheckouts, bookings, conversations, eq, pushTokens } from "@nevile/db";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runScheduledJobs } from "./bookings/jobs.ts";
import { handlePaymentEvent } from "./bookings/payouts.ts";
import type { Context } from "./context.ts";
import { createCaller } from "./root.ts";
import { createHarness, type Harness, trpcError } from "./test/harness.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const ABOUT = "Family-run lawn crew serving Bedford, Sackville and Halifax for ten years.";
const BEDFORD: LatLng = { lat: 44.7316, lng: -63.6545 };
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
};
const address = { line1: "12 Example Lane", line2: "", city: "Halifax", postalCode: "B3H 4R2" };
const CUSTOMER_TOKEN = "ExponentPushToken[customer-device-0001]";
const OWNER_TOKEN = "ExponentPushToken[owner-device-000001]";

describe.skipIf(!TEST_DATABASE_URL)("the app: in-app payment and push (SPEC §20)", () => {
  let harness: Harness;
  let owner: Context;
  let customer: Context;
  let stranger: Context;
  let businessId = "";
  let serviceId = "";

  const call = (ctx: Context) => createCaller(ctx);
  const deps = () => ({
    db: harness.db,
    payments: harness.payments,
    email: harness.anonymous().email,
    push: harness.anonymous().push,
    config: harness.anonymous().config,
    now: harness.clock.now,
  });

  /** The first open window of a service, as the app's booking screen would pick. */
  async function firstWindow(): Promise<{ date: string; windowStart: number }> {
    const view = await call(customer).bookings.availability({ serviceId, days: 7 });
    for (const day of view.days) {
      const window = day.windows.find((candidate) => candidate.available);
      if (window) return { date: day.date, windowStart: window.startMinute };
    }
    throw new Error("no open window");
  }

  beforeAll(async () => {
    harness = await createHarness(TEST_DATABASE_URL as string);
    harness.clock.set(novAt(1, 10));
    owner = (await harness.signUp("ann@example.com", "Ann Owner")).ctx;
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
    customer = (await harness.signUp("cora@example.com", "Cora Customer")).ctx;
    stranger = (await harness.signUp("sam@example.com", "Sam Stranger")).ctx;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("books and pays inside the app with the test payment sheet", async () => {
    const window = await firstWindow();
    const checkout = await call(customer).bookings.appCheckout({
      serviceId,
      ...window,
      address,
      notes: "Side gate",
    });
    expect(checkout).toMatchObject({
      provider: "fake",
      amountCents: 6453,
      capture: "now",
      publishableKey: null,
    });
    expect(checkout.clientSecret).toMatch(/_secret_/);

    // Not paid yet; and nobody else can finish or pay it.
    expect(
      await call(customer).bookings.finishAppCheckout({ checkoutId: checkout.checkoutId }),
    ).toEqual({ status: "pending" });
    expect(
      (
        await trpcError(
          call(stranger).bookings.payTestCheckout({ checkoutId: checkout.checkoutId }),
        )
      ).code,
    ).toBe("NOT_FOUND");

    const outcome = await call(customer).bookings.payTestCheckout({
      checkoutId: checkout.checkoutId,
    });
    expect(outcome.status).toBe("booked");
    const bookingId = "bookingId" in outcome ? outcome.bookingId : "";
    const [booking] = await harness.db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking).toMatchObject({
      status: "confirmed",
      totalCents: 6453,
      title: "Weekly mowing",
    });
    // Finishing again is harmless; the booking has its conversation.
    expect(
      await call(customer).bookings.finishAppCheckout({ checkoutId: checkout.checkoutId }),
    ).toEqual({ status: "booked", bookingId });
    const [chat] = await harness.db
      .select()
      .from(conversations)
      .where(eq(conversations.bookingId, bookingId));
    expect(chat).toBeDefined();
  });

  it("completes from the payment webhook even if the app never comes back", async () => {
    harness.clock.set(novAt(1, 11));
    const checkout = await call(customer).bookings.appCheckout({
      serviceId,
      ...(await firstWindow()),
      address,
      notes: "",
    });
    await handlePaymentEvent(deps(), harness.payments.payIntent(checkout.paymentIntentId));
    const [row] = await harness.db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, checkout.checkoutId));
    expect(row?.status).toBe("completed");
    expect(row?.bookingId).toBeTruthy();
  });

  it("cancels unpaid in-app payments when the 30-minute hold runs out", async () => {
    harness.clock.set(novAt(1, 12));
    const checkout = await call(customer).bookings.appCheckout({
      serviceId,
      ...(await firstWindow()),
      address,
      notes: "",
    });
    harness.clock.set(novAt(1, 12, 45));
    await runScheduledJobs(deps(), harness.storage);
    expect((await harness.payments.getPaymentIntent(checkout.paymentIntentId)).payment).toBe(
      "canceled",
    );
    expect(
      await call(customer).bookings.finishAppCheckout({ checkoutId: checkout.checkoutId }),
    ).toEqual({ status: "expired" });
    expect(
      (
        await trpcError(
          call(customer).bookings.payTestCheckout({ checkoutId: checkout.checkoutId }),
        )
      ).message,
    ).toBe("This payment is closed.");
  });

  it("keeps the test payment out of production", async () => {
    harness.clock.set(novAt(1, 13));
    const checkout = await call(customer).bookings.appCheckout({
      serviceId,
      ...(await firstWindow()),
      address,
      notes: "",
    });
    vi.stubEnv("NODE_ENV", "production");
    expect(
      (
        await trpcError(
          call(customer).bookings.payTestCheckout({ checkoutId: checkout.checkoutId }),
        )
      ).code,
    ).toBe("NOT_FOUND");
  });

  it("closes the earlier payment when the customer starts again", async () => {
    harness.clock.set(novAt(1, 14));
    const first = await call(customer).bookings.appCheckout({
      serviceId,
      ...(await firstWindow()),
      address,
      notes: "",
    });
    const second = await call(customer).bookings.appCheckout({
      serviceId,
      ...(await firstWindow()),
      address,
      notes: "",
    });
    expect((await harness.payments.getPaymentIntent(first.paymentIntentId)).payment).toBe(
      "canceled",
    );
    expect((await harness.payments.getPaymentIntent(second.paymentIntentId)).payment).toBe(
      "unpaid",
    );
  });

  it("registers phones and pushes quotes, replies and chat to them", async () => {
    harness.clock.set(novAt(2, 9));
    await call(customer).push.register({ token: CUSTOMER_TOKEN, platform: "ios" });
    await call(owner).push.register({ token: OWNER_TOKEN, platform: "android" });
    expect(
      (await trpcError(call(customer).push.register({ token: "not-a-token", platform: "ios" })))
        .code,
    ).toBe("BAD_REQUEST");
    harness.pushes.length = 0;

    // A quote request pushes to the business's phone.
    const { groupId } = await call(customer).quotes.request({
      categorySlug: "lawn-mowing",
      businessIds: [businessId],
      details: "Front and back lawn, about 400 square metres, overgrown after the summer.",
      postalCode: "B3H 1A1",
      timing: "flexible",
    });
    expect(harness.pushes).toEqual([
      {
        to: OWNER_TOKEN,
        title: "Nevile",
        body: "Cora asked for a quote: Lawn Mowing near B3H",
        path: expect.stringMatching(/^\/business\/quotes\//),
      },
    ]);

    // The quote pushes to the customer's phone.
    const request = (await call(owner).businessQuotes.list({ businessId })).needsReply[0];
    await call(owner).businessQuotes.reply({
      businessId,
      requestId: request?.id ?? "",
      priceCents: 9000,
      durationMinutes: 60,
      note: "",
    });
    expect(harness.pushes.at(-1)).toMatchObject({
      to: CUSTOMER_TOKEN,
      body: "Ann's Lawns sent you a quote: Lawn Mowing",
      path: `/quotes/${groupId}`,
    });

    // Chat pushes the message. Contact details are hidden before a paid booking, but Cora
    // already paid Ann above, so the number shows.
    const conversationId = request?.conversationId ?? "";
    await call(owner).chat.send({ conversationId, body: "Call me at 902-555-0142", photoIds: [] });
    expect(harness.pushes.at(-1)).toEqual({
      to: CUSTOMER_TOKEN,
      title: "Ann's Lawns",
      body: "Call me at 902-555-0142",
      path: `/inbox/${conversationId}`,
    });

    // Book the quote in the app; it's always confirmed on payment.
    const quote = (await call(customer).quotes.get({ groupId })).pros[0]?.quote;
    const options = await call(customer).quotes.bookingOptions({
      quoteId: quote?.id ?? "",
      days: 7,
    });
    const day = options.days.find((candidate) => candidate.windows.some((w) => w.available));
    const checkout = await call(customer).quotes.appCheckout({
      quoteId: quote?.id ?? "",
      date: day?.date ?? "",
      windowStart: day?.windows.find((w) => w.available)?.startMinute ?? 0,
      address,
      notes: "",
    });
    expect(checkout.capture).toBe("now");
    const outcome = await call(customer).bookings.payTestCheckout({
      checkoutId: checkout.checkoutId,
    });
    expect(outcome.status).toBe("booked");

    // Signing out unregisters; dead tokens are dropped when the push service says so.
    await call(customer).push.unregister({ token: CUSTOMER_TOKEN });
    harness.deadTokens.add(OWNER_TOKEN);
    await call(customer).chat.send({ conversationId, body: "Thanks!", photoIds: [] });
    const left = await harness.db.select().from(pushTokens);
    expect(left).toEqual([]);
  });

  it("needs Stripe's publishable key to pay in the app with Stripe", async () => {
    harness.clock.set(novAt(3, 9));
    const stripeLike = Object.create(harness.payments, { name: { value: "stripe" } });
    const ctx = { ...customer, payments: stripeLike };
    const error = await trpcError(
      call(ctx).bookings.appCheckout({ serviceId, ...(await firstWindow()), address, notes: "" }),
    );
    expect(error.message).toBe("We couldn't start the payment. Please try again.");
  });
});
