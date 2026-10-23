import Stripe from "stripe";
import {
  type AccountState,
  type CheckoutSession,
  type CheckoutState,
  type CreateCheckoutInput,
  type PaymentEvent,
  type PaymentProvider,
  WebhookSignatureError,
} from "./types.ts";

export type StripeProviderOptions = {
  secretKey: string;
  /** Signing secret of the account webhook endpoint (checkout events). */
  webhookSecret: string;
  /** Signing secret of the Connect webhook endpoint (connected-account events), if separate. */
  connectWebhookSecret?: string;
  /** For tests: replaces the network (see `Stripe.createFetchHttpClient`). */
  httpClient?: NonNullable<ConstructorParameters<typeof Stripe>[1]>["httpClient"];
};

const CURRENCY = "cad";

/**
 * Stripe Connect with separate charges and transfers (SPEC §7, §19): customers pay Nevile
 * on Stripe Checkout, money is held on the platform, and each business is paid by a
 * transfer to its Express account. Every write carries an idempotency key, so retries
 * (ours or the SDK's) never double-charge, double-refund or double-pay.
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  readonly #stripe: Stripe;
  readonly #webhookSecrets: string[];

  constructor(options: StripeProviderOptions) {
    this.#stripe = new Stripe(options.secretKey, {
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: "Nevile" },
      ...(options.httpClient ? { httpClient: options.httpClient } : {}),
    });
    this.#webhookSecrets = [options.webhookSecret, options.connectWebhookSecret].filter(
      (secret): secret is string => Boolean(secret),
    );
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const session = await this.#stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: input.reference,
        ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
        line_items: input.lines.map((line) => ({
          quantity: 1,
          price_data: {
            currency: CURRENCY,
            unit_amount: line.amountCents,
            product_data: { name: line.name },
          },
        })),
        // Manual capture (approval requests) works with cards; keep every booking on cards.
        payment_method_types: ["card"],
        payment_intent_data: {
          capture_method: input.capture === "hold" ? "manual" : "automatic",
          description: input.description,
          metadata: { ...input.metadata, reference: input.reference },
          transfer_group: input.reference,
        },
        metadata: { ...input.metadata, reference: input.reference },
        expires_at: Math.floor(input.expiresAt.getTime() / 1000),
        success_url: input.successUrl.replace("{SESSION_ID}", "{CHECKOUT_SESSION_ID}"),
        cancel_url: input.cancelUrl,
      },
      { idempotencyKey: `checkout-${input.reference}` },
    );
    if (!session.url) throw new Error("Stripe didn't return a checkout URL.");
    return { id: session.id, url: session.url };
  }

  async getCheckout(sessionId: string): Promise<CheckoutState> {
    const session = await this.#stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });
    const intent =
      session.payment_intent && typeof session.payment_intent === "object"
        ? session.payment_intent
        : null;
    return {
      id: session.id,
      reference: session.client_reference_id,
      status:
        session.status === "complete"
          ? "complete"
          : session.status === "expired"
            ? "expired"
            : "open",
      payment:
        intent?.status === "succeeded"
          ? "paid"
          : intent?.status === "requires_capture"
            ? "authorized"
            : "unpaid",
      paymentIntentId:
        intent?.id ?? (typeof session.payment_intent === "string" ? session.payment_intent : null),
      amountCents: session.amount_total,
    };
  }

  async expireCheckout(sessionId: string): Promise<void> {
    const session = await this.#stripe.checkout.sessions.retrieve(sessionId);
    if (session.status !== "open") return;
    await this.#stripe.checkout.sessions.expire(sessionId);
  }

  async capture(paymentIntentId: string): Promise<void> {
    const intent = await this.#stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status === "succeeded") return;
    await this.#stripe.paymentIntents.capture(
      paymentIntentId,
      {},
      { idempotencyKey: `capture-${paymentIntentId}` },
    );
  }

  async release(paymentIntentId: string): Promise<void> {
    const intent = await this.#stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status === "canceled") return;
    await this.#stripe.paymentIntents.cancel(
      paymentIntentId,
      {},
      { idempotencyKey: `release-${paymentIntentId}` },
    );
  }

  async refund(input: { paymentIntentId: string; amountCents: number; idempotencyKey: string }) {
    const refund = await this.#stripe.refunds.create(
      { payment_intent: input.paymentIntentId, amount: input.amountCents },
      { idempotencyKey: input.idempotencyKey },
    );
    return { refundId: refund.id };
  }

  async createAccount(input: { businessId: string; email: string | null }) {
    const account = await this.#stripe.accounts.create(
      {
        type: "express",
        country: "CA",
        default_currency: CURRENCY,
        ...(input.email ? { email: input.email } : {}),
        capabilities: { transfers: { requested: true } },
        metadata: { businessId: input.businessId },
      },
      { idempotencyKey: `account-${input.businessId}` },
    );
    return { accountId: account.id };
  }

  async onboardingLink(input: { accountId: string; returnUrl: string; refreshUrl: string }) {
    const link = await this.#stripe.accountLinks.create({
      account: input.accountId,
      type: "account_onboarding",
      return_url: input.returnUrl,
      refresh_url: input.refreshUrl,
    });
    return { url: link.url };
  }

  async getAccount(accountId: string): Promise<AccountState> {
    const account = await this.#stripe.accounts.retrieve(accountId);
    return {
      payoutsEnabled: account.payouts_enabled === true,
      detailsSubmitted: account.details_submitted === true,
    };
  }

  async transfer(input: {
    accountId: string;
    amountCents: number;
    idempotencyKey: string;
    description: string;
  }) {
    const transfer = await this.#stripe.transfers.create(
      {
        amount: input.amountCents,
        currency: CURRENCY,
        destination: input.accountId,
        description: input.description,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return { transferId: transfer.id };
  }

  parseWebhook(rawBody: string, signature: string | null): PaymentEvent {
    if (!signature) throw new WebhookSignatureError();
    let event: Stripe.Event | null = null;
    for (const secret of this.#webhookSecrets) {
      try {
        event = this.#stripe.webhooks.constructEvent(rawBody, signature, secret);
        break;
      } catch {
        // Try the next endpoint's secret.
      }
    }
    if (!event) throw new WebhookSignatureError();
    switch (event.type) {
      case "checkout.session.completed":
        return {
          type: "checkout_completed",
          sessionId: event.data.object.id,
          reference: event.data.object.client_reference_id,
        };
      case "checkout.session.expired":
        return {
          type: "checkout_expired",
          sessionId: event.data.object.id,
          reference: event.data.object.client_reference_id,
        };
      case "account.updated":
        return {
          type: "account_updated",
          accountId: event.data.object.id,
          payoutsEnabled: event.data.object.payouts_enabled === true,
        };
      default:
        return { type: "ignored", eventType: event.type };
    }
  }
}
