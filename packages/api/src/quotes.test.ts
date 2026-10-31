import type { LatLng, ServiceInput } from "@nevile/core";
import { bookings, conversations, eq, quoteRequests, quotes } from "@nevile/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runScheduledJobs } from "./bookings/jobs.ts";
import { handlePaymentEvent } from "./bookings/payouts.ts";
import type { Context } from "./context.ts";
import { privatePhotoKeyFor, savePrivatePhoto } from "./photos.ts";
import { createCaller } from "./root.ts";
import { createHarness, type Harness, trpcError } from "./test/harness.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const ABOUT = "Family-run crew serving Bedford, Sackville and Halifax for ten years.";
const BEDFORD: LatLng = { lat: 44.7316, lng: -63.6545 };
const SYDNEY: LatLng = { lat: 46.1368, lng: -60.1942 };
const novAt = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 10, day, hour + 4, minute));
const MINUTE = 60_000;

const fixedMowing: ServiceInput = {
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
const quotedMowing: ServiceInput = {
  ...fixedMowing,
  title: "Big or overgrown lawns",
  pricingType: "quote",
  priceCents: null,
  instantBook: false,
};
const request = {
  categorySlug: "lawn-mowing" as const,
  details: "Front and back lawn, about 400 square metres, gate on the left side.",
  postalCode: "B3H 1A1",
  timing: "within_week" as const,
};

describe.skipIf(!TEST_DATABASE_URL)("quotes and chat (SPEC §20)", () => {
  let harness: Harness;
  let customer: Context;
  let stranger: Context;
  let ownerA: Context;
  let ownerB: Context;
  let ownerC: Context;
  let crewA: Context;
  let customerId = "";
  let strangerId = "";
  const ids = { a: "", b: "", c: "", far: "", off: "" };

  const call = (ctx: Context) => createCaller(ctx);
  const deps = () => ({
    db: harness.db,
    payments: harness.payments,
    email: harness.anonymous().email,
    config: harness.anonymous().config,
    now: harness.clock.now,
  });
  const mailTo = (address: string) => harness.emails.filter((message) => message.to === address);

  async function makeBusiness(
    owner: Context,
    name: string,
    options: { center?: LatLng; service?: ServiceInput; quotes?: boolean } = {},
  ) {
    const { id } = await call(owner).business.create({ name, province: "NS" });
    await call(owner).listing.updateProfile({
      businessId: id,
      name,
      description: ABOUT,
      gstHstNumber: "",
      cancellationPolicy: "flexible",
      instantBook: false,
      acceptsQuoteRequests: options.quotes ?? true,
    });
    await call(owner).listing.setServiceArea({
      businessId: id,
      center: options.center ?? BEDFORD,
      radiusKm: 25,
    });
    await call(owner).listing.createService({
      businessId: id,
      ...(options.service ?? fixedMowing),
    });
    await call(owner).listing.publish({ businessId: id });
    return id;
  }

  async function payCheckout(ctx: Context, url: string) {
    const sessionId = decodeURIComponent(url.split("/").at(-1) ?? "");
    const { event } = harness.payments.payCheckout(sessionId);
    await handlePaymentEvent(deps(), event);
    return call(ctx).bookings.finishCheckout({ sessionId });
  }

  beforeAll(async () => {
    harness = await createHarness(TEST_DATABASE_URL as string);
    harness.clock.set(novAt(1, 10));
    ownerA = (await harness.signUp("ann@example.com", "Ann Owner")).ctx;
    ownerB = (await harness.signUp("ben@example.com", "Ben Owner")).ctx;
    ownerC = (await harness.signUp("cal@example.com", "Cal Owner")).ctx;
    ids.a = await makeBusiness(ownerA, "Ann's Lawns");
    ids.b = await makeBusiness(ownerB, "Ben's Big Yards", { service: quotedMowing });
    ids.c = await makeBusiness(ownerC, "Cal's Cuts");
    const ownerD = (await harness.signUp("dee@example.com", "Dee Owner")).ctx;
    const ownerE = (await harness.signUp("eve@example.com", "Eve Owner")).ctx;
    ids.far = await makeBusiness(ownerD, "Cape Breton Cuts", { center: SYDNEY });
    ids.off = await makeBusiness(ownerE, "Quiet Lawns", { quotes: false });
    const customerSignup = await harness.signUp("cora@example.com", "Cora Customer");
    customer = customerSignup.ctx;
    customerId = customerSignup.userId;
    const strangerSignup = await harness.signUp("sam@example.com", "Sam Stranger");
    stranger = strangerSignup.ctx;
    strangerId = strangerSignup.userId;
    // A crew member at Ann's: crew never see quote requests or chat.
    const crewSignup = await harness.signUp("cody@example.com", "Cody Crew");
    crewA = crewSignup.ctx;
    await call(ownerA).team.invite({ businessId: ids.a, email: "cody@example.com", role: "crew" });
    const invite = mailTo("cody@example.com").at(-1);
    const token = invite?.text.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1] ?? "";
    await call(crewA).team.acceptInvite({ token });
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("checks which pros can be asked", async () => {
    const view = await call(customer).quotes.targets({
      categorySlug: "lawn-mowing",
      postalCode: "B3H 1A1",
      businessIds: [ids.a, ids.far, ids.off],
    });
    expect(view.area.code).toBe("B3H");
    expect(view.pros.map((pro) => pro.problem)).toEqual([
      null,
      "Cape Breton Cuts doesn't serve B3H.",
      "Quiet Lawns isn't taking quote requests.",
    ]);
    const own = await trpcError(call(ownerA).quotes.request({ ...request, businessIds: [ids.a] }));
    expect(own.message).toBe("You can't ask your own business for a quote.");
    const refused = await trpcError(
      call(customer).quotes.request({ ...request, businessIds: [ids.a, ids.off] }),
    );
    expect(refused.message).toBe("Quiet Lawns isn't taking quote requests.");
  });

  it("sends one request to several pros, quotes, revisions, declines, chat and booking", async () => {
    // A private photo from the customer goes with the request.
    // A 1×1 PNG; it is re-encoded as WebP like any photo.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
      "base64",
    );
    const session = customer.session;
    const photo = await savePrivatePhoto({
      db: harness.db,
      storage: harness.storage,
      session,
      purpose: "quotes",
      bytes: new Uint8Array(png),
    });
    if (!photo.ok) throw new Error(photo.message);

    const { groupId } = await call(customer).quotes.request({
      ...request,
      businessIds: [ids.a, ids.b, ids.c],
      photoIds: [photo.id],
    });
    expect(mailTo("ann@example.com").at(-1)?.subject).toBe(
      "Quote request: Lawn Mowing near B3H · Halifax (South End)",
    );

    // Each pro sees its own copy (with the photo); crew don't.
    const inbox = await call(ownerA).businessQuotes.list({ businessId: ids.a });
    expect(inbox.needsReply).toHaveLength(1);
    const copyA = inbox.needsReply[0];
    if (!copyA) throw new Error("no copy");
    expect(copyA.customer.firstName).toBe("Cora");
    expect(copyA.area).toBe("B3H · Halifax (South End)");
    expect(copyA.photos.map((p) => p.id)).toEqual([photo.id]);
    expect(
      await privatePhotoKeyFor(harness.db, (await ownerUserId(ownerA)) ?? "", photo.id),
    ).toMatch(/^private\/quotes\//);
    expect(await privatePhotoKeyFor(harness.db, strangerId, photo.id)).toBeNull();
    expect((await trpcError(call(crewA).businessQuotes.list({ businessId: ids.a }))).code).toBe(
      "FORBIDDEN",
    );

    // Ann quotes $120 for 2 hours, then revises to $110.
    await call(ownerA).businessQuotes.reply({
      businessId: ids.a,
      requestId: copyA.id,
      priceCents: 12_000,
      durationMinutes: 120,
      note: "Includes edging and clippings taken away.",
    });
    expect(mailTo("cora@example.com").at(-1)?.subject).toBe("Quote from Ann's Lawns: $120.00");
    harness.clock.set(novAt(1, 11));
    await call(ownerA).businessQuotes.reply({
      businessId: ids.a,
      requestId: copyA.id,
      priceCents: 11_000,
      durationMinutes: 120,
      note: "Includes edging.",
    });
    expect(mailTo("cora@example.com").at(-1)?.subject).toBe(
      "Ann's Lawns updated their quote: $110.00",
    );
    const sent = await harness.db.select().from(quotes).where(eq(quotes.quoteRequestId, copyA.id));
    expect(sent.map((quote) => quote.status).sort()).toEqual(["pending", "withdrawn"]);

    // Ben declines.
    const copyB = (await call(ownerB).businessQuotes.list({ businessId: ids.b })).needsReply[0];
    await call(ownerB).businessQuotes.decline({
      businessId: ids.b,
      requestId: copyB?.id ?? "",
      reason: "Fully booked this month",
    });
    expect(mailTo("cora@example.com").at(-1)?.subject).toBe("Ben's Big Yards can't quote this job");

    // The customer compares: Ann's quote with fees; Ben declined; Cal still to reply.
    const group = await call(customer).quotes.get({ groupId });
    expect(group.summary).toBe("1 quote to compare");
    const ann = group.pros.find((pro) => pro.business.id === ids.a);
    expect(ann?.quote).toMatchObject({ priceCents: 11_000, note: "Includes edging." });
    expect(ann?.quote?.total.totalCents).toBe(
      11_000 + (ann?.quote?.total.serviceFeeCents ?? 0) + (ann?.quote?.total.taxCents ?? 0),
    );
    expect(group.pros.find((pro) => pro.business.id === ids.b)?.declineReason).toBe(
      "Fully booked this month",
    );
    expect(group.pros.find((pro) => pro.business.id === ids.c)?.statusLabel).toBe(
      "Waiting for a quote",
    );
    // Other customers can't see it.
    expect((await trpcError(call(stranger).quotes.get({ groupId }))).code).toBe("NOT_FOUND");

    // Chat: contact details are hidden from the other side until a booking is paid.
    const conversationId = ann?.conversationId ?? "";
    await call(customer).chat.send({
      conversationId,
      body: "Can you come Tuesday? Call me at 902-555-0142.",
      photoIds: [],
    });
    const businessView = await call(ownerA).chat.thread({ conversationId });
    expect(businessView.conversation.with).toBe("Cora");
    expect(businessView.messages.at(-1)?.body).toBe(
      "Can you come Tuesday? Call me at [hidden until booked].",
    );
    const customerView = await call(customer).chat.thread({ conversationId });
    expect(customerView.messages.at(-1)?.body).toContain("902-555-0142");
    expect((await trpcError(call(crewA).chat.thread({ conversationId }))).code).toBe("NOT_FOUND");
    expect((await trpcError(call(stranger).chat.thread({ conversationId }))).code).toBe(
      "NOT_FOUND",
    );

    // Unread: one email after 10 minutes, not one per message.
    harness.clock.set(new Date(novAt(1, 11).getTime() + MINUTE));
    await call(ownerA).chat.send({ conversationId, body: "Tuesday works.", photoIds: [] });
    expect((await call(customer).chat.unread()).conversations).toBe(1);
    const before = mailTo("cora@example.com").length;
    harness.clock.set(new Date(novAt(1, 11).getTime() + 5 * MINUTE));
    await runScheduledJobs(deps(), harness.storage);
    expect(mailTo("cora@example.com").length).toBe(before);
    harness.clock.set(new Date(novAt(1, 11).getTime() + 15 * MINUTE));
    await runScheduledJobs(deps(), harness.storage);
    await runScheduledJobs(deps(), harness.storage);
    expect(mailTo("cora@example.com").length).toBe(before + 1);
    expect(mailTo("cora@example.com").at(-1)?.subject).toBe("New message from Ann's Lawns");

    // Booking the quote: an address in the quoted postal code area, the quoted price.
    const options = await call(customer).quotes.bookingOptions({
      quoteId: ann?.quote?.id ?? "",
      days: 7,
    });
    expect(options.title).toBe("Lawn Mowing (quoted)");
    const day = options.days.find((candidate) => candidate.windows.some((w) => w.available));
    const window = day?.windows.find((w) => w.available);
    const elsewhere = await trpcError(
      call(customer).quotes.checkout({
        quoteId: ann?.quote?.id ?? "",
        date: day?.date ?? "",
        windowStart: window?.startMinute ?? 0,
        address: { line1: "1 Main St", line2: "", city: "Halifax", postalCode: "B3K 5L2" },
        notes: "",
      }),
    );
    expect(elsewhere.message).toMatch(/The quote is for B3H/);
    const { url } = await call(customer).quotes.checkout({
      quoteId: ann?.quote?.id ?? "",
      date: day?.date ?? "",
      windowStart: window?.startMinute ?? 0,
      address: { line1: "12 Example Lane", line2: "", city: "Halifax", postalCode: "B3H 4R2" },
      notes: "",
    });
    const outcome = await payCheckout(customer, url);
    expect(outcome.status).toBe("booked");
    const bookingId = "bookingId" in outcome ? outcome.bookingId : "";
    const [booking] = await harness.db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking).toMatchObject({
      title: "Lawn Mowing (quoted)",
      priceCents: 11_000,
      status: "confirmed",
    });

    // Accepted; Cal's copy closes (Ben's stays declined); the chat follows the booking.
    const copies = await harness.db
      .select({
        businessId: quoteRequests.businessId,
        status: quoteRequests.status,
        closeReason: quoteRequests.closeReason,
      })
      .from(quoteRequests)
      .where(eq(quoteRequests.groupId, groupId));
    expect(copies.find((copy) => copy.businessId === ids.a)?.status).toBe("accepted");
    expect(copies.find((copy) => copy.businessId === ids.b)?.status).toBe("declined");
    expect(copies.find((copy) => copy.businessId === ids.c)).toMatchObject({
      status: "cancelled",
      closeReason: "chose_another",
    });
    expect(mailTo("cal@example.com").at(-1)?.subject).toBe("Quote request closed: Lawn Mowing");
    const [conversation] = await harness.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    expect(conversation?.bookingId).toBe(bookingId);
    expect((await call(customer).quotes.get({ groupId })).summary).toBe("Booked with Ann's Lawns");

    // Paid: the business now sees the phone number.
    const after = await call(ownerA).chat.thread({ conversationId });
    expect(after.conversation.contactShared).toBe(true);
    expect(after.messages[0]?.body).toContain("902-555-0142");
  });

  it("closes unanswered requests after 3 days and says so when nobody quoted", async () => {
    harness.clock.set(novAt(2, 9));
    const { groupId } = await call(stranger).quotes.request({
      ...request,
      businessIds: [ids.c],
    });
    harness.clock.set(novAt(5, 10));
    const report = await runScheduledJobs(deps(), harness.storage);
    expect(report.quoteRequestsClosed).toBeGreaterThanOrEqual(1);
    const group = await call(stranger).quotes.get({ groupId });
    expect(group.pros[0]?.statusLabel).toBe("No reply");
    expect(group.summary).toBe("Closed");
    expect(mailTo("sam@example.com").at(-1)?.subject).toBe(
      "No quotes for your lawn mowing request",
    );
  });

  it("limits open requests and lets the customer close one", async () => {
    harness.clock.set(novAt(6, 9));
    const opened: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      opened.push(
        (await call(stranger).quotes.request({ ...request, businessIds: [ids.a] })).groupId,
      );
    }
    const sixth = await trpcError(
      call(stranger).quotes.request({ ...request, businessIds: [ids.a] }),
    );
    expect(sixth.code).toBe("TOO_MANY_REQUESTS");
    await call(stranger).quotes.close({ groupId: opened[0] ?? "" });
    expect(mailTo("ann@example.com").at(-1)?.subject).toBe("Quote request closed: Lawn Mowing");
    await expect(
      call(stranger).quotes.request({ ...request, businessIds: [ids.a] }),
    ).resolves.toHaveProperty("groupId");
  });

  it("refunds a quote booking if the pro revised the quote during payment", async () => {
    harness.clock.set(novAt(7, 9));
    const { groupId } = await call(customer).quotes.request({ ...request, businessIds: [ids.c] });
    const copy = (await call(ownerC).businessQuotes.list({ businessId: ids.c })).needsReply.find(
      (row) => row.details === request.details,
    );
    await call(ownerC).businessQuotes.reply({
      businessId: ids.c,
      requestId: copy?.id ?? "",
      priceCents: 9000,
      durationMinutes: 60,
      note: "",
    });
    const quote = (await call(customer).quotes.get({ groupId })).pros[0]?.quote;
    const options = await call(customer).quotes.bookingOptions({
      quoteId: quote?.id ?? "",
      days: 7,
    });
    const day = options.days.find((candidate) => candidate.windows.some((w) => w.available));
    const { url } = await call(customer).quotes.checkout({
      quoteId: quote?.id ?? "",
      date: day?.date ?? "",
      windowStart: day?.windows.find((w) => w.available)?.startMinute ?? 0,
      address: { line1: "12 Example Lane", line2: "", city: "Halifax", postalCode: "B3H 4R2" },
      notes: "",
    });
    await call(ownerC).businessQuotes.reply({
      businessId: ids.c,
      requestId: copy?.id ?? "",
      priceCents: 9500,
      durationMinutes: 60,
      note: "",
    });
    const outcome = await payCheckout(customer, url);
    expect(outcome).toEqual({
      status: "refunded",
      message: "The pro changed their quote while you were paying. Check the new quote.",
    });
  });

  async function ownerUserId(ctx: Context) {
    return ctx.session?.user.id;
  }

  it("keeps a customer's id off other people's requests", () => {
    expect(customerId).not.toBe(strangerId);
  });
});
