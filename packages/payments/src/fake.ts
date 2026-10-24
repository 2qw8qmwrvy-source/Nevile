import { randomUUID } from "node:crypto";
import type {
  AccountState,
  AppPayment,
  CaptureMode,
  CardSetupPageInput,
  CardSetupState,
  CheckoutSession,
  CheckoutState,
  CreateCheckoutInput,
  CreatePaymentIntentInput,
  PaymentEvent,
  PaymentIntentState,
  PaymentProvider,
  SavedCard,
  SavedCardCharge,
  SavedCardChargeInput,
} from "./types.ts";

type FakeSession = {
  input: CreateCheckoutInput;
  status: CheckoutState["status"];
  paymentIntentId: string | null;
  amountCents: number;
};

type FakeIntent = {
  amountCents: number;
  status: "requires_payment_method" | "requires_capture" | "succeeded" | "canceled";
  refundedCents: number;
  /** In-app payments (SPEC §20) carry what the test payment screen shows. */
  app?: { reference: string; capture: CaptureMode; description: string };
};

type FakeSetup = {
  kind: "page" | "intent";
  reference: string;
  customerId: string;
  status: CardSetupState["status"];
  card: SavedCard | null;
  /** Page setups: where the test page sends the customer. */
  successUrl?: string;
  cancelUrl?: string;
};

/** In-process record of fake money movements, for the dev pages and tests. */
type FakeStore = {
  sessions: Map<string, FakeSession>;
  intents: Map<string, FakeIntent>;
  customers: Map<string, { userId: string }>;
  setups: Map<string, FakeSetup>;
  /** Saved test cards; `declines` makes every charge on it fail. */
  cards: Map<string, { customerId: string; declines: boolean }>;
  charges: Array<{ id: string; reference: string; amountCents: number; succeeded: boolean }>;
  accounts: Map<string, { businessId: string; payoutsEnabled: boolean }>;
  refunds: Array<{ id: string; paymentIntentId: string; amountCents: number; key: string }>;
  transfers: Array<{ id: string; accountId: string; amountCents: number; key: string }>;
};

// One store per process, shared by every copy of this module (Next bundles server code
// more than once in development).
const STORE_KEY = Symbol.for("nevile.fake-payments");

function store(): FakeStore {
  const global = globalThis as { [STORE_KEY]?: FakeStore };
  global[STORE_KEY] ??= {
    sessions: new Map(),
    intents: new Map(),
    customers: new Map(),
    setups: new Map(),
    cards: new Map(),
    charges: [],
    accounts: new Map(),
    refunds: [],
    transfers: [],
  };
  return global[STORE_KEY];
}

const fakeId = (prefix: string) => `fake_${prefix}_${randomUUID().replaceAll("-", "")}`;

/**
 * A payment provider with no real money, for development and tests (SPEC §19). Checkout
 * happens on the website's `/dev/fake-checkout/<id>` page and payout setup on
 * `/dev/fake-onboarding`; both call `payCheckout` / `finishOnboarding` here.
 * Production refuses to use it (see `createPaymentProviderFromEnv`).
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake" as const;
  readonly #siteUrl: string;

  constructor(options: { siteUrl: string }) {
    this.#siteUrl = options.siteUrl.replace(/\/+$/, "");
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const existing = [...store().sessions.entries()].find(
      ([, session]) => session.input.reference === input.reference,
    );
    if (existing) return { id: existing[0], url: this.#checkoutUrl(existing[0]) };
    const id = fakeId("cs");
    store().sessions.set(id, {
      input,
      status: "open",
      paymentIntentId: null,
      amountCents: input.lines.reduce((sum, line) => sum + line.amountCents, 0),
    });
    return { id, url: this.#checkoutUrl(id) };
  }

  #checkoutUrl(id: string): string {
    return `${this.#siteUrl}/dev/fake-checkout/${encodeURIComponent(id)}`;
  }

  async getCheckout(sessionId: string): Promise<CheckoutState> {
    const session = store().sessions.get(sessionId);
    if (!session) {
      return {
        id: sessionId,
        reference: null,
        status: "expired",
        payment: "unpaid",
        paymentIntentId: null,
        amountCents: null,
      };
    }
    if (session.status === "open" && session.input.expiresAt.getTime() <= Date.now()) {
      session.status = "expired";
    }
    const intent = session.paymentIntentId ? store().intents.get(session.paymentIntentId) : null;
    return {
      id: sessionId,
      reference: session.input.reference,
      status: session.status,
      payment:
        intent?.status === "succeeded"
          ? "paid"
          : intent?.status === "requires_capture"
            ? "authorized"
            : "unpaid",
      paymentIntentId: session.paymentIntentId,
      amountCents: session.amountCents,
    };
  }

  /** The details the fake checkout page shows, or null for an unknown session. */
  describeCheckout(sessionId: string) {
    const session = store().sessions.get(sessionId);
    if (!session) return null;
    return {
      lines: session.input.lines,
      amountCents: session.amountCents,
      description: session.input.description,
      capture: session.input.capture,
      status: session.status,
      cancelUrl: session.input.cancelUrl,
    };
  }

  /**
   * Pays (or, for approval requests, authorises) an open session, like a customer
   * finishing Stripe's checkout. Returns the event a webhook would have delivered and
   * where the customer goes next.
   */
  payCheckout(sessionId: string): { event: PaymentEvent; redirectUrl: string } {
    const session = store().sessions.get(sessionId);
    if (!session) throw new Error("Unknown checkout session.");
    if (session.status === "open" && session.input.expiresAt.getTime() <= Date.now()) {
      session.status = "expired";
    }
    if (session.status !== "open") throw new Error("This checkout is no longer open.");
    const intentId = fakeId("pi");
    store().intents.set(intentId, {
      amountCents: session.amountCents,
      status: session.input.capture === "hold" ? "requires_capture" : "succeeded",
      refundedCents: 0,
    });
    session.paymentIntentId = intentId;
    session.status = "complete";
    return {
      event: { type: "checkout_completed", sessionId, reference: session.input.reference },
      redirectUrl: session.input.successUrl.replace("{SESSION_ID}", encodeURIComponent(sessionId)),
    };
  }

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<AppPayment> {
    const existing = [...store().intents.entries()].find(
      ([, intent]) => intent.app?.reference === input.reference,
    );
    const id = existing?.[0] ?? fakeId("pi");
    if (!existing) {
      store().intents.set(id, {
        amountCents: input.amountCents,
        status: "requires_payment_method",
        refundedCents: 0,
        app: { reference: input.reference, capture: input.capture, description: input.description },
      });
    }
    return { id, clientSecret: `${id}_secret_fake` };
  }

  async getPaymentIntent(paymentIntentId: string): Promise<PaymentIntentState> {
    const intent = store().intents.get(paymentIntentId);
    return {
      id: paymentIntentId,
      reference: intent?.app?.reference ?? null,
      payment:
        intent?.status === "succeeded"
          ? "paid"
          : intent?.status === "requires_capture"
            ? "authorized"
            : intent?.status === "canceled" || !intent
              ? "canceled"
              : "unpaid",
      amountCents: intent?.amountCents ?? 0,
    };
  }

  async cancelPaymentIntent(paymentIntentId: string): Promise<void> {
    const intent = store().intents.get(paymentIntentId);
    if (intent?.status === "requires_payment_method") intent.status = "canceled";
  }

  /** What the app's test payment screen shows for an in-app payment, or null. */
  describeIntent(paymentIntentId: string) {
    const intent = store().intents.get(paymentIntentId);
    if (!intent?.app) return null;
    return {
      amountCents: intent.amountCents,
      description: intent.app.description,
      capture: intent.app.capture,
      status: intent.status,
    };
  }

  /**
   * Pays (or authorises, for a hold) an in-app payment, like a customer finishing the
   * payment sheet. Returns the event a webhook would have delivered.
   */
  payIntent(paymentIntentId: string): PaymentEvent {
    const intent = store().intents.get(paymentIntentId);
    if (!intent?.app) throw new Error("Unknown payment.");
    if (intent.status !== "requires_payment_method") throw new Error("This payment is closed.");
    const hold = intent.app.capture === "hold";
    intent.status = hold ? "requires_capture" : "succeeded";
    return {
      type: hold ? "payment_authorized" : "payment_succeeded",
      paymentIntentId,
      reference: intent.app.reference,
    };
  }

  async expireCheckout(sessionId: string): Promise<void> {
    const session = store().sessions.get(sessionId);
    if (session?.status === "open") session.status = "expired";
  }

  #intent(paymentIntentId: string): FakeIntent {
    const intent = store().intents.get(paymentIntentId);
    if (!intent) throw new Error(`Unknown payment ${paymentIntentId}.`);
    return intent;
  }

  async capture(paymentIntentId: string): Promise<void> {
    const intent = this.#intent(paymentIntentId);
    if (intent.status === "succeeded") return;
    if (intent.status !== "requires_capture") throw new Error("This payment can't be captured.");
    intent.status = "succeeded";
  }

  async release(paymentIntentId: string): Promise<void> {
    const intent = this.#intent(paymentIntentId);
    if (intent.status === "canceled") return;
    if (intent.status !== "requires_capture") throw new Error("This payment can't be released.");
    intent.status = "canceled";
  }

  async refund(input: { paymentIntentId: string; amountCents: number; idempotencyKey: string }) {
    const done = store().refunds.find((refund) => refund.key === input.idempotencyKey);
    if (done) return { refundId: done.id };
    const intent = this.#intent(input.paymentIntentId);
    if (intent.status !== "succeeded") throw new Error("Only charged payments can be refunded.");
    if (input.amountCents <= 0 || intent.refundedCents + input.amountCents > intent.amountCents) {
      throw new Error("Refund exceeds the amount charged.");
    }
    intent.refundedCents += input.amountCents;
    const id = fakeId("re");
    store().refunds.push({
      id,
      paymentIntentId: input.paymentIntentId,
      amountCents: input.amountCents,
      key: input.idempotencyKey,
    });
    return { refundId: id };
  }

  async createAccount(input: { businessId: string; email: string | null }) {
    const existing = [...store().accounts.entries()].find(
      ([, account]) => account.businessId === input.businessId,
    );
    if (existing) return { accountId: existing[0] };
    const accountId = fakeId("acct");
    store().accounts.set(accountId, { businessId: input.businessId, payoutsEnabled: false });
    return { accountId };
  }

  async onboardingLink(input: { accountId: string; returnUrl: string; refreshUrl: string }) {
    const query = new URLSearchParams({ account: input.accountId, return: input.returnUrl });
    return { url: `${this.#siteUrl}/dev/fake-onboarding?${query.toString()}` };
  }

  /** Finishes payout setup, like a business completing Stripe's onboarding. */
  finishOnboarding(accountId: string): PaymentEvent {
    const account = store().accounts.get(accountId);
    if (!account) throw new Error("Unknown account.");
    account.payoutsEnabled = true;
    return { type: "account_updated", accountId, payoutsEnabled: true };
  }

  async getAccount(accountId: string): Promise<AccountState> {
    const account = store().accounts.get(accountId);
    return {
      payoutsEnabled: account?.payoutsEnabled ?? false,
      detailsSubmitted: account?.payoutsEnabled ?? false,
    };
  }

  async transfer(input: {
    accountId: string;
    amountCents: number;
    idempotencyKey: string;
    description: string;
  }) {
    const done = store().transfers.find((transfer) => transfer.key === input.idempotencyKey);
    if (done) return { transferId: done.id };
    if (!store().accounts.get(input.accountId)?.payoutsEnabled) {
      throw new Error("Payouts aren't set up for this account.");
    }
    const id = fakeId("tr");
    store().transfers.push({
      id,
      accountId: input.accountId,
      amountCents: input.amountCents,
      key: input.idempotencyKey,
    });
    return { transferId: id };
  }

  async ensureCustomer(input: {
    userId: string;
    email: string | null;
    existingCustomerId: string | null;
  }) {
    if (input.existingCustomerId && store().customers.has(input.existingCustomerId)) {
      return { customerId: input.existingCustomerId };
    }
    const existing = [...store().customers.entries()].find(([, c]) => c.userId === input.userId);
    if (existing) return { customerId: existing[0] };
    const customerId = fakeId("cus");
    store().customers.set(customerId, { userId: input.userId });
    return { customerId };
  }

  async createCardSetupPage(input: CardSetupPageInput) {
    const existing = this.#setupFor(input.reference);
    const id = existing ?? fakeId("cs_setup");
    if (!existing) {
      store().setups.set(id, {
        kind: "page",
        reference: input.reference,
        customerId: input.customerId,
        status: "open",
        card: null,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
      });
    }
    return { id, url: `${this.#siteUrl}/dev/fake-card/${encodeURIComponent(id)}` };
  }

  async createCardSetupIntent(input: { reference: string; customerId: string }) {
    const existing = this.#setupFor(input.reference);
    const id = existing ?? fakeId("seti");
    if (!existing) {
      store().setups.set(id, {
        kind: "intent",
        reference: input.reference,
        customerId: input.customerId,
        status: "open",
        card: null,
      });
    }
    return { id, clientSecret: `${id}_secret_fake` };
  }

  #setupFor(reference: string): string | undefined {
    return [...store().setups.entries()].find(([, setup]) => setup.reference === reference)?.[0];
  }

  async getCardSetup(input: { kind: "page" | "intent"; id: string }): Promise<CardSetupState> {
    const setup = store().setups.get(input.id);
    if (!setup || setup.kind !== input.kind) {
      return { id: input.id, reference: null, status: "expired", card: null };
    }
    return { id: input.id, reference: setup.reference, status: setup.status, card: setup.card };
  }

  /** What the test card page shows, or null for an unknown setup. */
  describeCardSetup(setupId: string) {
    const setup = store().setups.get(setupId);
    if (!setup) return null;
    return { kind: setup.kind, status: setup.status, cancelUrl: setup.cancelUrl ?? null };
  }

  /**
   * Saves a test card, like a customer finishing Stripe's page or payment sheet.
   * `declining` saves one whose charges always fail. Returns the webhook event and, for
   * page setups, where the customer goes next.
   */
  completeCardSetup(
    setupId: string,
    options: { declining?: boolean } = {},
  ): { event: PaymentEvent; redirectUrl: string | null } {
    const setup = store().setups.get(setupId);
    if (!setup) throw new Error("Unknown card setup.");
    if (setup.status !== "open") throw new Error("This card setup is closed.");
    const paymentMethodId = fakeId("pm");
    store().cards.set(paymentMethodId, {
      customerId: setup.customerId,
      declines: options.declining === true,
    });
    setup.card = {
      paymentMethodId,
      brand: "visa",
      last4: options.declining ? "0002" : "4242",
      expMonth: 12,
      expYear: new Date().getUTCFullYear() + 3,
    };
    setup.status = "complete";
    return {
      event: { type: "card_setup_completed", setupId, reference: setup.reference },
      redirectUrl: setup.successUrl
        ? setup.successUrl.replace("{SESSION_ID}", encodeURIComponent(setupId))
        : null,
    };
  }

  /** Makes a saved test card start (or stop) declining, e.g. to test retries. */
  setCardDeclining(paymentMethodId: string, declines: boolean): void {
    const card = store().cards.get(paymentMethodId);
    if (!card) throw new Error("Unknown test card.");
    card.declines = declines;
  }

  async chargeSavedCard(input: SavedCardChargeInput): Promise<SavedCardCharge> {
    const done = store().charges.find((charge) => charge.reference === input.reference);
    if (done) {
      return done.succeeded
        ? { status: "succeeded", paymentIntentId: done.id }
        : {
            status: "failed",
            paymentIntentId: done.id,
            failureCode: "card_declined",
            failureMessage: "Your card was declined.",
          };
    }
    const card = store().cards.get(input.paymentMethodId);
    if (!card || card.customerId !== input.customerId) {
      throw new Error("That card isn't saved for this customer.");
    }
    const id = fakeId("pi");
    const succeeded = !card.declines;
    store().charges.push({
      id,
      reference: input.reference,
      amountCents: input.amountCents,
      succeeded,
    });
    store().intents.set(id, {
      amountCents: input.amountCents,
      status: succeeded ? "succeeded" : "canceled",
      refundedCents: 0,
    });
    if (succeeded) return { status: "succeeded", paymentIntentId: id };
    return {
      status: "failed",
      paymentIntentId: id,
      failureCode: "card_declined",
      failureMessage: "Your card was declined.",
    };
  }

  parseWebhook(): PaymentEvent {
    throw new Error("The fake payment provider doesn't receive webhooks.");
  }

  /** Money moved so far (tests and the dev pages). */
  ledger() {
    return {
      refunds: [...store().refunds],
      transfers: [...store().transfers],
      charges: [...store().charges],
    };
  }
}
