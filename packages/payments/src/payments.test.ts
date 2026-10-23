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

describe("Stripe provider", () => {
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
