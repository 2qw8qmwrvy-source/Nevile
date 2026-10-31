import Stripe from "stripe";
import {
  type AccountState,
  type AppPayment,
  type CardSetupPageInput,
  type CardSetupState,
  type CheckoutSession,
  type CheckoutState,
  type CreateCheckoutInput,
  type CreatePaymentIntentInput,
  type PaymentEvent,
  type PaymentIntentState,
  type PaymentProvider,
  type SavedCard,
  type SavedCardCharge,
  type SavedCardChargeInput,
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

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<AppPayment> {
    const intent = await this.#stripe.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: CURRENCY,
        capture_method: input.capture === "hold" ? "manual" : "automatic",
        // Cards, including Apple Pay and Google Pay, which also support holds.
        payment_method_types: ["card"],
        description: input.description,
        ...(input.customerEmail ? { receipt_email: input.customerEmail } : {}),
        metadata: { ...input.metadata, reference: input.reference },
        transfer_group: input.reference,
      },
      { idempotencyKey: `intent-${input.reference}` },
    );
    if (!intent.client_secret) throw new Error("Stripe didn't return a client secret.");
    return { id: intent.id, clientSecret: intent.client_secret };
  }

  async getPaymentIntent(paymentIntentId: string): Promise<PaymentIntentState> {
    const intent = await this.#stripe.paymentIntents.retrieve(paymentIntentId);
    return {
      id: intent.id,
      reference: intent.metadata.reference ?? null,
      payment:
        intent.status === "succeeded"
          ? "paid"
          : intent.status === "requires_capture"
            ? "authorized"
            : intent.status === "canceled"
              ? "canceled"
              : "unpaid",
      amountCents: intent.amount,
    };
  }

  async cancelPaymentIntent(paymentIntentId: string): Promise<void> {
    const intent = await this.#stripe.paymentIntents.retrieve(paymentIntentId);
    // Held or charged money is released or refunded by the booking flows, never here.
    if (["succeeded", "canceled", "requires_capture", "processing"].includes(intent.status)) return;
    await this.#stripe.paymentIntents.cancel(
      paymentIntentId,
      { cancellation_reason: "abandoned" },
      { idempotencyKey: `cancel-intent-${paymentIntentId}` },
    );
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

  async ensureCustomer(input: {
    userId: string;
    email: string | null;
    existingCustomerId: string | null;
  }) {
    if (input.existingCustomerId) return { customerId: input.existingCustomerId };
    const customer = await this.#stripe.customers.create(
      { ...(input.email ? { email: input.email } : {}), metadata: { userId: input.userId } },
      { idempotencyKey: `customer-${input.userId}` },
    );
    return { customerId: customer.id };
  }

  async createCardSetupPage(input: CardSetupPageInput) {
    const session = await this.#stripe.checkout.sessions.create(
      {
        mode: "setup",
        currency: CURRENCY,
        customer: input.customerId,
        client_reference_id: input.reference,
        payment_method_types: ["card"],
        setup_intent_data: { metadata: { reference: input.reference } },
        metadata: { reference: input.reference },
        success_url: input.successUrl.replace("{SESSION_ID}", "{CHECKOUT_SESSION_ID}"),
        cancel_url: input.cancelUrl,
      },
      { idempotencyKey: `card-setup-${input.reference}` },
    );
    if (!session.url) throw new Error("Stripe didn't return a setup URL.");
    return { id: session.id, url: session.url };
  }

  async createCardSetupIntent(input: { reference: string; customerId: string }) {
    const intent = await this.#stripe.setupIntents.create(
      {
        customer: input.customerId,
        // Cards, including Apple Pay and Google Pay, kept for charges while the customer is away.
        payment_method_types: ["card"],
        usage: "off_session",
        metadata: { reference: input.reference },
      },
      { idempotencyKey: `card-intent-${input.reference}` },
    );
    if (!intent.client_secret) throw new Error("Stripe didn't return a client secret.");
    return { id: intent.id, clientSecret: intent.client_secret };
  }

  async getCardSetup(input: { kind: "page" | "intent"; id: string }): Promise<CardSetupState> {
    let intent: Stripe.SetupIntent | null;
    let reference: string | null;
    let status: CardSetupState["status"];
    if (input.kind === "page") {
      const session = await this.#stripe.checkout.sessions.retrieve(input.id, {
        expand: ["setup_intent.payment_method"],
      });
      intent =
        session.setup_intent && typeof session.setup_intent === "object"
          ? session.setup_intent
          : null;
      reference = session.client_reference_id;
      status =
        session.status === "complete"
          ? "complete"
          : session.status === "expired"
            ? "expired"
            : "open";
    } else {
      intent = await this.#stripe.setupIntents.retrieve(input.id, { expand: ["payment_method"] });
      reference = intent.metadata?.reference ?? null;
      status =
        intent.status === "succeeded"
          ? "complete"
          : intent.status === "canceled"
            ? "expired"
            : "open";
    }
    const method =
      intent?.status === "succeeded" &&
      intent.payment_method &&
      typeof intent.payment_method === "object"
        ? intent.payment_method
        : null;
    return { id: input.id, reference, status, card: method ? cardOf(method) : null };
  }

  async chargeSavedCard(input: SavedCardChargeInput): Promise<SavedCardCharge> {
    try {
      const intent = await this.#stripe.paymentIntents.create(
        {
          amount: input.amountCents,
          currency: CURRENCY,
          customer: input.customerId,
          payment_method: input.paymentMethodId,
          payment_method_types: ["card"],
          off_session: true,
          confirm: true,
          description: input.description,
          ...(input.customerEmail ? { receipt_email: input.customerEmail } : {}),
          metadata: { ...input.metadata, reference: input.reference },
          transfer_group: input.reference,
        },
        { idempotencyKey: `charge-${input.reference}` },
      );
      if (intent.status === "succeeded") return { status: "succeeded", paymentIntentId: intent.id };
      return {
        status: "failed",
        paymentIntentId: intent.id,
        failureCode:
          intent.status === "requires_action" ? "authentication_required" : intent.status,
        failureMessage: "Your bank didn't approve the charge.",
      };
    } catch (error) {
      if (error instanceof Stripe.errors.StripeCardError) {
        return {
          status: "failed",
          paymentIntentId: error.payment_intent?.id ?? null,
          failureCode: error.decline_code ?? error.code ?? "card_declined",
          failureMessage: error.message,
        };
      }
      throw error;
    }
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
        if (event.data.object.mode === "setup") {
          return {
            type: "card_setup_completed",
            setupId: event.data.object.id,
            reference: event.data.object.client_reference_id,
          };
        }
        return {
          type: "checkout_completed",
          sessionId: event.data.object.id,
          reference: event.data.object.client_reference_id,
        };
      case "setup_intent.succeeded":
        return {
          type: "card_setup_completed",
          setupId: event.data.object.id,
          reference: event.data.object.metadata?.reference ?? null,
        };
      case "checkout.session.expired":
        return {
          type: "checkout_expired",
          sessionId: event.data.object.id,
          reference: event.data.object.client_reference_id,
        };
      case "payment_intent.succeeded":
        return {
          type: "payment_succeeded",
          paymentIntentId: event.data.object.id,
          reference: event.data.object.metadata.reference ?? null,
        };
      case "payment_intent.amount_capturable_updated":
        return {
          type: "payment_authorized",
          paymentIntentId: event.data.object.id,
          reference: event.data.object.metadata.reference ?? null,
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

/** The safe-to-show parts of a card (wallet cards report their underlying card). */
function cardOf(method: Stripe.PaymentMethod): SavedCard {
  return {
    paymentMethodId: method.id,
    brand: method.card?.brand ?? "card",
    last4: method.card?.last4 ?? "",
    expMonth: method.card?.exp_month ?? 0,
    expYear: method.card?.exp_year ?? 0,
  };
}
