import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
  createPaymentProviderFromEnv,
  FakePaymentProvider,
  StripePaymentProvider,
  WebhookSignatureError,
} from "./index.ts";
import type { CreateCheckoutInput } from "./types.ts";

const checkoutInput = (reference: string, capture: "now" | "hold"): CreateCheckoutInput => ({
  reference,
  lines: [
    { name: "Weekly mowing", amountCents: 6000 },
    { name: "Service fee", amountCents: 422 },
    { name: "HST", amountCents: 899 },
  ],
  capture,
  customerEmail: "cora@example.com",
  description: "Weekly mowing, Mon Nov 2, 8–11 am",
  successUrl: "https://nevile.test/bookings/return?session={SESSION_ID}",
  cancelUrl: "https://nevile.test/pros/harbour",
  expiresAt: new Date(Date.now() + 30 * 60_000),
  metadata: { businessId: "b1" },
});

describe("fake provider", () => {
  const fake = new FakePaymentProvider({ siteUrl: "https://nevile.test/" });

  it("charges Instant Book checkouts and redirects with the session id", async () => {
    const session = await fake.createCheckout(checkoutInput("chk-now", "now"));
    expect(session.url).toBe(`https://nevile.test/dev/fake-checkout/${session.id}`);
    // The same reference never opens a second session.
    expect((await fake.createCheckout(checkoutInput("chk-now", "now"))).id).toBe(session.id);
    expect(fake.describeCheckout(session.id)?.amountCents).toBe(7321);

    const { event, redirectUrl } = fake.payCheckout(session.id);
    expect(event).toEqual({
      type: "checkout_completed",
      sessionId: session.id,
      reference: "chk-now",
    });
    expect(redirectUrl).toBe(`https://nevile.test/bookings/return?session=${session.id}`);
    const state = await fake.getCheckout(session.id);
    expect(state).toMatchObject({ status: "complete", payment: "paid", amountCents: 7321 });
    expect(() => fake.payCheckout(session.id)).toThrow("no longer open");
  });

  it("holds approval checkouts until captured or released", async () => {
    const held = await fake.createCheckout(checkoutInput("chk-hold", "hold"));
    fake.payCheckout(held.id);
    const state = await fake.getCheckout(held.id);
    expect(state.payment).toBe("authorized");
    await fake.capture(state.paymentIntentId ?? "");
    expect((await fake.getCheckout(held.id)).payment).toBe("paid");

    const released = await fake.createCheckout(checkoutInput("chk-release", "hold"));
    fake.payCheckout(released.id);
    const intent = (await fake.getCheckout(released.id)).paymentIntentId ?? "";
    await fake.release(intent);
    await fake.release(intent); // releasing twice is fine
    await expect(fake.capture(intent)).rejects.toThrow("can't be captured");
    await expect(
      fake.refund({ paymentIntentId: intent, amountCents: 100, idempotencyKey: "r0" }),
    ).rejects.toThrow("Only charged payments");
  });

  it("refunds at most what was charged, once per key", async () => {
    const session = await fake.createCheckout(checkoutInput("chk-refund", "now"));
    fake.payCheckout(session.id);
    const intent = (await fake.getCheckout(session.id)).paymentIntentId ?? "";
    const first = await fake.refund({
      paymentIntentId: intent,
      amountCents: 7000,
      idempotencyKey: "r1",
    });
    expect(
      await fake.refund({ paymentIntentId: intent, amountCents: 7000, idempotencyKey: "r1" }),
    ).toEqual(first);
    await expect(
      fake.refund({ paymentIntentId: intent, amountCents: 400, idempotencyKey: "r2" }),
    ).rejects.toThrow("exceeds");
    await fake.refund({ paymentIntentId: intent, amountCents: 321, idempotencyKey: "r3" });
  });

  it("expires sessions that run out of time", async () => {
    const session = await fake.createCheckout({
      ...checkoutInput("chk-late", "now"),
      expiresAt: new Date(Date.now() - 1000),
    });
    expect((await fake.getCheckout(session.id)).status).toBe("expired");
    expect(() => fake.payCheckout(session.id)).toThrow("no longer open");
    expect((await fake.getCheckout("fake_cs_unknown")).status).toBe("expired");
  });

  it("pays businesses only after payout setup", async () => {
    const { accountId } = await fake.createAccount({ businessId: "b-pay", email: null });
    expect((await fake.createAccount({ businessId: "b-pay", email: null })).accountId).toBe(
      accountId,
    );
    const link = await fake.onboardingLink({
      accountId,
      returnUrl: "https://nevile.test/business/payouts",
      refreshUrl: "https://nevile.test/business/payouts",
    });
    expect(link.url).toContain("/dev/fake-onboarding?account=");
    const transfer = {
      accountId,
      amountCents: 5820,
      idempotencyKey: "payout-1",
      description: "Week of Nov 2",
    };
    await expect(fake.transfer(transfer)).rejects.toThrow("Payouts aren't set up");
    expect(fake.finishOnboarding(accountId)).toEqual({
      type: "account_updated",
      accountId,
      payoutsEnabled: true,
    });
    expect(await fake.getAccount(accountId)).toEqual({
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const done = await fake.transfer(transfer);
    expect(await fake.transfer(transfer)).toEqual(done);
    expect(fake.ledger().transfers.filter((entry) => entry.key === "payout-1")).toHaveLength(1);
  });
});

type Recorded = { method: string; path: string; body: URLSearchParams; headers: Headers };

/** A Stripe client whose network is a function returning canned objects. */
function stripeWith(respond: (request: Recorded) => unknown) {
  const requests: Recorded[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const request: Recorded = {
      method: init?.method ?? "GET",
      path: url.pathname,
      body: new URLSearchParams(typeof init?.body === "string" ? init.body : url.search),
      headers: new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]),
    };
    requests.push(request);
    return new Response(JSON.stringify(respond(request)), {
      status: 200,
      headers: { "content-type": "application/json", "request-id": "req_test" },
    });
  };
  const provider = new StripePaymentProvider({
    secretKey: "sk_test_123",
    webhookSecret: "whsec_account",
    connectWebhookSecret: "whsec_connect",
    httpClient: Stripe.createFetchHttpClient(fetchImpl as typeof fetch),
  });
  return { provider, requests };
}

describe("fake provider: in-app payments (SPEC §20)", () => {
  const fake = new FakePaymentProvider({ siteUrl: "https://nevile.test/" });
  const intentInput = (reference: string, capture: "now" | "hold") => ({
    reference,
    amountCents: 6453,
    capture,
    customerEmail: null,
    description: "Weekly mowing",
    metadata: {},
  });

  it("creates one intent per checkout and charges it when the test sheet pays", async () => {
    const first = await fake.createPaymentIntent(intentInput("app-1", "now"));
    expect(await fake.createPaymentIntent(intentInput("app-1", "now"))).toEqual(first);
    expect(first.clientSecret).toMatch(/_secret_/);
    expect((await fake.getPaymentIntent(first.id)).payment).toBe("unpaid");
    expect(fake.payIntent(first.id)).toEqual({
      type: "payment_succeeded",
      paymentIntentId: first.id,
      reference: "app-1",
    });
    expect(await fake.getPaymentIntent(first.id)).toEqual({
      id: first.id,
      reference: "app-1",
      payment: "paid",
      amountCents: 6453,
    });
    expect(() => fake.payIntent(first.id)).toThrow("closed");
    // Paid money can be refunded like any other charge.
    await expect(
      fake.refund({ paymentIntentId: first.id, amountCents: 1000, idempotencyKey: "app-r1" }),
    ).resolves.toHaveProperty("refundId");
  });

  it("holds approval payments and cancels abandoned ones", async () => {
    const held = await fake.createPaymentIntent(intentInput("app-2", "hold"));
    expect(fake.payIntent(held.id).type).toBe("payment_authorized");
    await fake.cancelPaymentIntent(held.id);
    expect((await fake.getPaymentIntent(held.id)).payment).toBe("authorized");
    await fake.release(held.id);
    expect((await fake.getPaymentIntent(held.id)).payment).toBe("canceled");

    const abandoned = await fake.createPaymentIntent(intentInput("app-3", "now"));
    await fake.cancelPaymentIntent(abandoned.id);
    expect((await fake.getPaymentIntent(abandoned.id)).payment).toBe("canceled");
    expect(() => fake.payIntent(abandoned.id)).toThrow();
  });
});

describe("Stripe provider", () => {
  it("creates in-app payment intents in CAD, held for approvals, once per checkout", async () => {
    const { provider, requests } = stripeWith(() => ({
      id: "pi_app_1",
      object: "payment_intent",
      client_secret: "pi_app_1_secret_x",
    }));
    const payment = await provider.createPaymentIntent({
      reference: "chk-app",
      amountCents: 6453,
      capture: "hold",
      customerEmail: "cora@example.com",
      description: "Weekly mowing",
      metadata: { businessId: "b1" },
    });
    expect(payment).toEqual({ id: "pi_app_1", clientSecret: "pi_app_1_secret_x" });
    const [request] = requests;
    expect(request?.path).toBe("/v1/payment_intents");
    expect(request?.headers.get("idempotency-key")).toBe("intent-chk-app");
    expect(request?.body.get("amount")).toBe("6453");
    expect(request?.body.get("currency")).toBe("cad");
    expect(request?.body.get("capture_method")).toBe("manual");
    expect(request?.body.get("metadata[reference]")).toBe("chk-app");
    expect(request?.body.get("receipt_email")).toBe("cora@example.com");
  });

  it("reads in-app payment states and their webhooks", async () => {
    const { provider } = stripeWith(() => ({
      id: "pi_app_2",
      object: "payment_intent",
      status: "requires_capture",
      amount: 6453,
      metadata: { reference: "chk-2" },
    }));
    expect(await provider.getPaymentIntent("pi_app_2")).toEqual({
      id: "pi_app_2",
      reference: "chk-2",
      payment: "authorized",
      amountCents: 6453,
    });
    const event = (type: string) =>
      JSON.stringify({
        id: "evt_pi",
        object: "event",
        type,
        data: {
          object: { id: "pi_app_2", object: "payment_intent", metadata: { reference: "chk-2" } },
        },
      });
    const parse = (payload: string) =>
      provider.parseWebhook(
        payload,
        Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_account" }),
      );
    expect(parse(event("payment_intent.succeeded"))).toEqual({
      type: "payment_succeeded",
      paymentIntentId: "pi_app_2",
      reference: "chk-2",
    });
    expect(parse(event("payment_intent.amount_capturable_updated"))).toEqual({
      type: "payment_authorized",
      paymentIntentId: "pi_app_2",
      reference: "chk-2",
    });
  });

  it("opens Checkout with manual capture for approval requests", async () => {
    const { provider, requests } = stripeWith(() => ({
      id: "cs_test_1",
      object: "checkout.session",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
    }));
    const session = await provider.createCheckout(checkoutInput("chk-1", "hold"));
    expect(session).toEqual({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
    });
    const [request] = requests;
    expect(request?.path).toBe("/v1/checkout/sessions");
    expect(request?.headers.get("idempotency-key")).toBe("checkout-chk-1");
    const body = request?.body;
    expect(body?.get("payment_intent_data[capture_method]")).toBe("manual");
    expect(body?.get("line_items[0][price_data][currency]")).toBe("cad");
    expect(body?.get("line_items[0][price_data][unit_amount]")).toBe("6000");
    expect(body?.get("line_items[2][price_data][unit_amount]")).toBe("899");
    expect(body?.get("client_reference_id")).toBe("chk-1");
    expect(body?.get("success_url")).toBe(
      "https://nevile.test/bookings/return?session={CHECKOUT_SESSION_ID}",
    );
    expect(body?.get("payment_method_types[0]")).toBe("card");
  });

  it("reads held and paid payments from the session's payment intent", async () => {
    const { provider } = stripeWith(() => ({
      id: "cs_test_2",
      object: "checkout.session",
      status: "complete",
      client_reference_id: "chk-2",
      amount_total: 7321,
      payment_intent: { id: "pi_2", object: "payment_intent", status: "requires_capture" },
    }));
    expect(await provider.getCheckout("cs_test_2")).toEqual({
      id: "cs_test_2",
      reference: "chk-2",
      status: "complete",
      payment: "authorized",
      paymentIntentId: "pi_2",
      amountCents: 7321,
    });
  });

  it("refunds and pays out in Canadian dollars with idempotency keys", async () => {
    const { provider, requests } = stripeWith((request) =>
      request.path === "/v1/refunds"
        ? { id: "re_1", object: "refund" }
        : { id: "tr_1", object: "transfer" },
    );
    await provider.refund({
      paymentIntentId: "pi_3",
      amountCents: 3000,
      idempotencyKey: "refund-x",
    });
    await provider.transfer({
      accountId: "acct_9",
      amountCents: 5820,
      idempotencyKey: "payout-y",
      description: "Nevile payout",
    });
    const [refund, transfer] = requests;
    expect(refund?.body.get("amount")).toBe("3000");
    expect(refund?.headers.get("idempotency-key")).toBe("refund-x");
    expect(transfer?.path).toBe("/v1/transfers");
    expect(transfer?.body.get("currency")).toBe("cad");
    expect(transfer?.body.get("destination")).toBe("acct_9");
    expect(transfer?.headers.get("idempotency-key")).toBe("payout-y");
  });

  it("only trusts webhooks signed with one of its secrets", () => {
    const { provider } = stripeWith(() => ({}));
    const payload = JSON.stringify({
      id: "evt_1",
      object: "event",
      type: "account.updated",
      data: { object: { id: "acct_9", object: "account", payouts_enabled: true } },
    });
    const signed = (secret: string) =>
      Stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(provider.parseWebhook(payload, signed("whsec_connect"))).toEqual({
      type: "account_updated",
      accountId: "acct_9",
      payoutsEnabled: true,
    });
    expect(() => provider.parseWebhook(payload, signed("whsec_wrong"))).toThrow(
      WebhookSignatureError,
    );
    expect(() => provider.parseWebhook(payload, null)).toThrow(WebhookSignatureError);

    const completed = JSON.stringify({
      id: "evt_2",
      object: "event",
      type: "checkout.session.completed",
      data: { object: { id: "cs_9", object: "checkout.session", client_reference_id: "chk-9" } },
    });
    expect(
      provider.parseWebhook(
        completed,
        Stripe.webhooks.generateTestHeaderString({ payload: completed, secret: "whsec_account" }),
      ),
    ).toEqual({ type: "checkout_completed", sessionId: "cs_9", reference: "chk-9" });
  });
});

describe("provider from env", () => {
  it("uses the fake outside production and refuses it in production", () => {
    expect(createPaymentProviderFromEnv({ NODE_ENV: "development" }).name).toBe("fake");
    expect(() =>
      createPaymentProviderFromEnv({ NODE_ENV: "production", PAYMENTS_PROVIDER: "fake" }),
    ).toThrow(/development only/);
  });

  it("needs Stripe keys, and live keys in production", () => {
    expect(() => createPaymentProviderFromEnv({ NODE_ENV: "production" })).toThrow(
      "Payments need STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.",
    );
    const keys = { STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_WEBHOOK_SECRET: "whsec_x" };
    expect(() => createPaymentProviderFromEnv({ NODE_ENV: "production", ...keys })).toThrow(
      /test key/,
    );
    expect(
      createPaymentProviderFromEnv({
        NODE_ENV: "production",
        NEVILE_ALLOW_TEST_PAYMENTS: "true",
        ...keys,
      }).name,
    ).toBe("stripe");
    expect(createPaymentProviderFromEnv({ PAYMENTS_PROVIDER: "stripe", ...keys }).name).toBe(
      "stripe",
    );
    expect(() => createPaymentProviderFromEnv({ PAYMENTS_PROVIDER: "paypal" })).toThrow(/must be/);
  });
});

describe("saved cards (SPEC §21)", () => {
  const fake = new FakePaymentProvider({ siteUrl: "https://nevile.test/" });

  it("fake: saves a test card on the page or sheet, then charges it while the customer is away", async () => {
    const { customerId } = await fake.ensureCustomer({
      userId: "u1",
      email: "cora@example.com",
      existingCustomerId: null,
    });
    expect(
      await fake.ensureCustomer({ userId: "u1", email: null, existingCustomerId: null }),
    ).toEqual({ customerId });

    const page = await fake.createCardSetupPage({
      reference: "setup-1",
      customerId,
      successUrl: "https://nevile.test/account/card?setup={SESSION_ID}",
      cancelUrl: "https://nevile.test/account",
    });
    expect(page.url).toBe(`https://nevile.test/dev/fake-card/${page.id}`);
    expect(
      (await fake.createCardSetupPage({ ...pageInput(customerId), reference: "setup-1" })).id,
    ).toBe(page.id);
    const { event, redirectUrl } = fake.completeCardSetup(page.id);
    expect(event).toEqual({ type: "card_setup_completed", setupId: page.id, reference: "setup-1" });
    expect(redirectUrl).toBe(`https://nevile.test/account/card?setup=${page.id}`);
    const saved = await fake.getCardSetup({ kind: "page", id: page.id });
    expect(saved).toMatchObject({ status: "complete", card: { brand: "visa", last4: "4242" } });

    const charge = await fake.chargeSavedCard({
      reference: "pay-1",
      customerId,
      paymentMethodId: saved.card?.paymentMethodId ?? "",
      amountCents: 6457,
      customerEmail: null,
      description: "Weekly mowing, May 4",
      metadata: {},
    });
    expect(charge.status).toBe("succeeded");
    // A retry with the same reference never charges twice.
    await fake.chargeSavedCard({
      reference: "pay-1",
      customerId,
      paymentMethodId: saved.card?.paymentMethodId ?? "",
      amountCents: 6457,
      customerEmail: null,
      description: "",
      metadata: {},
    });
    expect(fake.ledger().charges.filter((c) => c.reference === "pay-1")).toHaveLength(1);
    // Refunds work on these charges like any other.
    if (charge.status !== "succeeded") throw new Error("not charged");
    await fake.refund({
      paymentIntentId: charge.paymentIntentId,
      amountCents: 1000,
      idempotencyKey: "r1",
    });
  });

  it("fake: declining cards fail with a reason, and only the owner's card can be charged", async () => {
    const { customerId } = await fake.ensureCustomer({
      userId: "u2",
      email: null,
      existingCustomerId: null,
    });
    const sheet = await fake.createCardSetupIntent({ reference: "setup-2", customerId });
    expect(sheet.clientSecret).toContain("_secret_");
    fake.completeCardSetup(sheet.id, { declining: true });
    const card = (await fake.getCardSetup({ kind: "intent", id: sheet.id })).card;
    expect(card?.last4).toBe("0002");
    const input = {
      reference: "pay-2",
      customerId,
      paymentMethodId: card?.paymentMethodId ?? "",
      amountCents: 4500,
      customerEmail: null,
      description: "Snow visit",
      metadata: {},
    };
    expect(await fake.chargeSavedCard(input)).toMatchObject({
      status: "failed",
      failureCode: "card_declined",
    });
    fake.setCardDeclining(card?.paymentMethodId ?? "", false);
    expect((await fake.chargeSavedCard({ ...input, reference: "pay-3" })).status).toBe("succeeded");
    await expect(
      fake.chargeSavedCard({ ...input, reference: "pay-4", customerId: "fake_cus_x" }),
    ).rejects.toThrow();
  });

  it("Stripe: creates the customer once and saves cards for later charges", async () => {
    const { provider, requests } = stripeWith((request) =>
      request.path === "/v1/customers"
        ? { id: "cus_1", object: "customer" }
        : request.path === "/v1/setup_intents"
          ? { id: "seti_1", object: "setup_intent", client_secret: "seti_1_secret_x" }
          : { id: "cs_set_1", object: "checkout.session", url: "https://checkout.stripe.test/set" },
    );
    expect(
      await provider.ensureCustomer({
        userId: "u1",
        email: "cora@example.com",
        existingCustomerId: null,
      }),
    ).toEqual({ customerId: "cus_1" });
    expect(requests[0]?.headers.get("idempotency-key")).toBe("customer-u1");
    expect(
      await provider.ensureCustomer({ userId: "u1", email: null, existingCustomerId: "cus_1" }),
    ).toEqual({ customerId: "cus_1" });
    expect(requests).toHaveLength(1);

    await provider.createCardSetupPage({ ...pageInput("cus_1"), reference: "setup-9" });
    const page = requests.at(-1);
    expect(page?.path).toBe("/v1/checkout/sessions");
    expect(page?.body.get("mode")).toBe("setup");
    expect(page?.body.get("customer")).toBe("cus_1");
    expect(page?.body.get("success_url")).toBe(
      "https://nevile.test/account/card?setup={CHECKOUT_SESSION_ID}",
    );
    expect(page?.headers.get("idempotency-key")).toBe("card-setup-setup-9");

    expect(
      await provider.createCardSetupIntent({ reference: "setup-10", customerId: "cus_1" }),
    ).toEqual({
      id: "seti_1",
      clientSecret: "seti_1_secret_x",
    });
    expect(requests.at(-1)?.body.get("usage")).toBe("off_session");
  });

  it("Stripe: reads the saved card and charges it off-session", async () => {
    const card = {
      id: "pm_1",
      object: "payment_method",
      card: { brand: "mastercard", last4: "4444", exp_month: 8, exp_year: 2029 },
    };
    const { provider, requests } = stripeWith((request) =>
      request.path.startsWith("/v1/setup_intents")
        ? {
            id: "seti_2",
            object: "setup_intent",
            status: "succeeded",
            payment_method: card,
            metadata: { reference: "setup-2" },
          }
        : { id: "pi_9", object: "payment_intent", status: "succeeded" },
    );
    expect(await provider.getCardSetup({ kind: "intent", id: "seti_2" })).toEqual({
      id: "seti_2",
      reference: "setup-2",
      status: "complete",
      card: {
        paymentMethodId: "pm_1",
        brand: "mastercard",
        last4: "4444",
        expMonth: 8,
        expYear: 2029,
      },
    });
    const charge = await provider.chargeSavedCard({
      reference: "pay-9",
      customerId: "cus_1",
      paymentMethodId: "pm_1",
      amountCents: 6457,
      customerEmail: "cora@example.com",
      description: "Weekly mowing",
      metadata: { bookingId: "b1" },
    });
    expect(charge).toEqual({ status: "succeeded", paymentIntentId: "pi_9" });
    const request = requests.at(-1);
    expect(request?.body.get("off_session")).toBe("true");
    expect(request?.body.get("confirm")).toBe("true");
    expect(request?.body.get("payment_method")).toBe("pm_1");
    expect(request?.headers.get("idempotency-key")).toBe("charge-pay-9");
  });

  it("Stripe: a declined card is a failed result, not an error", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          error: {
            type: "card_error",
            code: "card_declined",
            decline_code: "insufficient_funds",
            message: "Your card has insufficient funds.",
            payment_intent: { id: "pi_declined", object: "payment_intent" },
          },
        }),
        { status: 402, headers: { "content-type": "application/json", "request-id": "req_x" } },
      );
    const provider = new StripePaymentProvider({
      secretKey: "sk_test_123",
      webhookSecret: "whsec_account",
      httpClient: Stripe.createFetchHttpClient(fetchImpl as typeof fetch),
    });
    expect(
      await provider.chargeSavedCard({
        reference: "pay-10",
        customerId: "cus_1",
        paymentMethodId: "pm_1",
        amountCents: 100,
        customerEmail: null,
        description: "",
        metadata: {},
      }),
    ).toEqual({
      status: "failed",
      paymentIntentId: "pi_declined",
      failureCode: "insufficient_funds",
      failureMessage: "Your card has insufficient funds.",
    });
  });

  it("Stripe: maps card setup webhooks", () => {
    const { provider } = stripeWith(() => ({}));
    const signed = (payload: string) =>
      provider.parseWebhook(
        payload,
        Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_account" }),
      );
    const session = JSON.stringify({
      id: "evt_3",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_set",
          object: "checkout.session",
          mode: "setup",
          client_reference_id: "setup-3",
        },
      },
    });
    expect(signed(session)).toEqual({
      type: "card_setup_completed",
      setupId: "cs_set",
      reference: "setup-3",
    });
    const intent = JSON.stringify({
      id: "evt_4",
      object: "event",
      type: "setup_intent.succeeded",
      data: {
        object: { id: "seti_4", object: "setup_intent", metadata: { reference: "setup-4" } },
      },
    });
    expect(signed(intent)).toEqual({
      type: "card_setup_completed",
      setupId: "seti_4",
      reference: "setup-4",
    });
  });
});

function pageInput(customerId: string) {
  return {
    reference: "setup-x",
    customerId,
    successUrl: "https://nevile.test/account/card?setup={SESSION_ID}",
    cancelUrl: "https://nevile.test/account",
  };
}
