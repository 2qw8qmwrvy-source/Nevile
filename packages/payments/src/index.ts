import { FakePaymentProvider } from "./fake.ts";
import { StripePaymentProvider } from "./stripe.ts";
import type { PaymentProvider } from "./types.ts";

export { FakePaymentProvider } from "./fake.ts";
export { StripePaymentProvider, type StripeProviderOptions } from "./stripe.ts";
export * from "./types.ts";

/**
 * The provider for this environment:
 * - PAYMENTS_PROVIDER=fake (default outside production): no real money, test checkout page;
 * - PAYMENTS_PROVIDER=stripe (required in production): STRIPE_SECRET_KEY,
 *   STRIPE_WEBHOOK_SECRET, optional STRIPE_CONNECT_WEBHOOK_SECRET.
 * `NEXT_PUBLIC_SITE_URL` is the site the fake checkout pages live on.
 */
export function createPaymentProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PaymentProvider {
  const production = env.NODE_ENV === "production";
  const mode = env.PAYMENTS_PROVIDER || (production ? "stripe" : "fake");
  if (mode === "fake") {
    if (production) {
      throw new Error("PAYMENTS_PROVIDER=fake is for development only; use stripe in production.");
    }
    return new FakePaymentProvider({
      siteUrl: env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
    });
  }
  if (mode !== "stripe") {
    throw new Error(`PAYMENTS_PROVIDER must be "stripe" or "fake", got "${mode}".`);
  }
  const missing = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"].filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`Payments need ${missing.join(", ")}.`);
  if (
    production &&
    env.STRIPE_SECRET_KEY?.startsWith("sk_test_") &&
    env.NEVILE_ALLOW_TEST_PAYMENTS !== "true"
  ) {
    throw new Error(
      "STRIPE_SECRET_KEY is a test key. Use the live key in production (or set NEVILE_ALLOW_TEST_PAYMENTS=true on staging).",
    );
  }
  return new StripePaymentProvider({
    secretKey: env.STRIPE_SECRET_KEY as string,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET as string,
    connectWebhookSecret: env.STRIPE_CONNECT_WEBHOOK_SECRET || undefined,
  });
}

let shared: PaymentProvider | undefined;

/** One provider per process, created on first use. */
export function getPaymentProvider(): PaymentProvider {
  shared ??= createPaymentProviderFromEnv();
  return shared;
}

/**
 * The process-wide provider, resolved on first use: a missing production configuration
 * fails the requests that move money instead of every request.
 */
export const lazyPaymentProvider: PaymentProvider = {
  get name() {
    return getPaymentProvider().name;
  },
  createCheckout: (input) => getPaymentProvider().createCheckout(input),
  getCheckout: (id) => getPaymentProvider().getCheckout(id),
  expireCheckout: (id) => getPaymentProvider().expireCheckout(id),
  capture: (id) => getPaymentProvider().capture(id),
  release: (id) => getPaymentProvider().release(id),
  refund: (input) => getPaymentProvider().refund(input),
  createAccount: (input) => getPaymentProvider().createAccount(input),
  onboardingLink: (input) => getPaymentProvider().onboardingLink(input),
  getAccount: (id) => getPaymentProvider().getAccount(id),
  transfer: (input) => getPaymentProvider().transfer(input),
  parseWebhook: (body, signature) => getPaymentProvider().parseWebhook(body, signature),
};
