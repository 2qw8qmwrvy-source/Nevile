/** Where money moves: Stripe in production, the built-in fake in development and tests. */
export type ProviderName = "stripe" | "fake";

/** Instant Book charges now; approval requests only hold the amount on the card. */
export type CaptureMode = "now" | "hold";

export type CheckoutLine = { name: string; amountCents: number };

export type CreateCheckoutInput = {
  /** Our checkout id; also the idempotency key, so a retry never opens two sessions. */
  reference: string;
  /** Shown on the payment page; they add up to the amount charged. */
  lines: CheckoutLine[];
  capture: CaptureMode;
  customerEmail: string | null;
  description: string;
  /** Where the customer lands after paying. `{SESSION_ID}` is replaced with the session id. */
  successUrl: string;
  cancelUrl: string;
  /** At least 30 minutes ahead (Stripe's minimum). */
  expiresAt: Date;
  metadata: Record<string, string>;
};

export type CheckoutSession = { id: string; url: string };

export type CheckoutState = {
  id: string;
  /** Our checkout id, if the session carries one. */
  reference: string | null;
  status: "open" | "complete" | "expired";
  /** `authorized`: held on the card until captured or released. */
  payment: "paid" | "authorized" | "unpaid";
  paymentIntentId: string | null;
  amountCents: number | null;
};

/** Paying inside the phone app (SPEC §20): a payment intent the app confirms itself. */
export type CreatePaymentIntentInput = {
  /** Our checkout id; also the idempotency key, so a retry never creates two intents. */
  reference: string;
  amountCents: number;
  capture: CaptureMode;
  customerEmail: string | null;
  description: string;
  metadata: Record<string, string>;
};

/** What the app needs to show the payment sheet. */
export type AppPayment = { id: string; clientSecret: string };

export type PaymentIntentState = {
  id: string;
  reference: string | null;
  /** `authorized`: held on the card; `canceled`: closed without a charge. */
  payment: "paid" | "authorized" | "unpaid" | "canceled";
  amountCents: number;
};

export type AccountState = { payoutsEnabled: boolean; detailsSubmitted: boolean };

/** What a provider notification means for Nevile. */
export type PaymentEvent =
  | { type: "checkout_completed"; sessionId: string; reference: string | null }
  | { type: "checkout_expired"; sessionId: string; reference: string | null }
  | { type: "account_updated"; accountId: string; payoutsEnabled: boolean }
  /** An in-app payment was charged (or, for a hold, authorised). */
  | { type: "payment_succeeded"; paymentIntentId: string; reference: string | null }
  | { type: "payment_authorized"; paymentIntentId: string; reference: string | null }
  | { type: "ignored"; eventType: string };

export class WebhookSignatureError extends Error {
  constructor() {
    super("Invalid payment webhook signature.");
    this.name = "WebhookSignatureError";
  }
}

/**
 * Everything Nevile asks of a payment provider (SPEC §7, §19, §20). Card details are only
 * ever entered on the provider's own checkout page or payment sheet.
 */
export interface PaymentProvider {
  readonly name: ProviderName;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  getCheckout(sessionId: string): Promise<CheckoutState>;
  /** Closes an unpaid session early (no-op once it's complete or expired). */
  expireCheckout(sessionId: string): Promise<void>;
  /** In-app payment (SPEC §20): the app confirms it with the provider's payment sheet. */
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<AppPayment>;
  getPaymentIntent(paymentIntentId: string): Promise<PaymentIntentState>;
  /** Closes an unpaid intent (no-op once it's paid, held or closed). */
  cancelPaymentIntent(paymentIntentId: string): Promise<void>;
  /** Charges a held amount. */
  capture(paymentIntentId: string): Promise<void>;
  /** Releases a held amount without charging it. */
  release(paymentIntentId: string): Promise<void>;
  refund(input: {
    paymentIntentId: string;
    amountCents: number;
    idempotencyKey: string;
  }): Promise<{ refundId: string }>;
  /** A connected account the business will be paid out to. */
  createAccount(input: {
    businessId: string;
    email: string | null;
  }): Promise<{ accountId: string }>;
  /** Hosted onboarding (identity and bank account) for a connected account. */
  onboardingLink(input: {
    accountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<{ url: string }>;
  getAccount(accountId: string): Promise<AccountState>;
  /** Moves money from Nevile's balance to a business's connected account. */
  transfer(input: {
    accountId: string;
    amountCents: number;
    idempotencyKey: string;
    description: string;
  }): Promise<{ transferId: string }>;
  /** Verifies and reads a webhook; throws `WebhookSignatureError` if it isn't genuine. */
  parseWebhook(rawBody: string, signature: string | null): PaymentEvent;
}
