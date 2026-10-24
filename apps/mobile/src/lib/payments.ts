/**
 * Paying inside the app (SPEC §20). With Stripe, the payment sheet (cards, Apple Pay,
 * Google Pay) confirms the payment intent the API created; card details never reach
 * Nevile. With the test provider (development), the app's test payment screen pays it.
 * The Stripe module is loaded only when it's needed.
 */
import type { AppRouter, inferRouterOutputs } from "@nevile/api";

import { APP_SCHEME } from "./auth.ts";

export type AppCheckout = inferRouterOutputs<AppRouter>["bookings"]["appCheckout"];

/** Apple Pay merchant id (set up in the Apple developer account; see the app README). */
const MERCHANT_ID = process.env.EXPO_PUBLIC_APPLE_MERCHANT_ID?.trim() || "merchant.ca.nevile.app";

export type SheetResult =
  | { kind: "paid" }
  | { kind: "canceled" }
  | { kind: "failed"; message: string };

let initialisedKey: string | null = null;

/** Shows Stripe's payment sheet for an in-app checkout. */
export async function presentStripeSheet(checkout: AppCheckout): Promise<SheetResult> {
  if (!checkout.publishableKey) {
    return { kind: "failed", message: "Payments aren't set up in the app yet." };
  }
  const stripe = await import("@stripe/stripe-react-native");
  if (initialisedKey !== checkout.publishableKey) {
    await stripe.initStripe({
      publishableKey: checkout.publishableKey,
      merchantIdentifier: MERCHANT_ID,
      urlScheme: APP_SCHEME,
    });
    initialisedKey = checkout.publishableKey;
  }
  const testMode = checkout.publishableKey.startsWith("pk_test_");
  const init = await stripe.initPaymentSheet({
    merchantDisplayName: "Nevile",
    paymentIntentClientSecret: checkout.clientSecret,
    applePay: { merchantCountryCode: "CA" },
    googlePay: { merchantCountryCode: "CA", currencyCode: "CAD", testEnv: testMode },
    defaultBillingDetails: { address: { country: "CA" } },
    returnURL: `${APP_SCHEME}://stripe-redirect`,
  });
  if (init.error)
    return { kind: "failed", message: init.error.localizedMessage ?? init.error.message };
  const result = await stripe.presentPaymentSheet();
  if (!result.error) return { kind: "paid" };
  if (result.error.code === "Canceled") return { kind: "canceled" };
  return { kind: "failed", message: result.error.localizedMessage ?? result.error.message };
}

export type CheckoutOutcome = inferRouterOutputs<AppRouter>["bookings"]["finishAppCheckout"];

/**
 * After paying: turns the checkout into a booking. The payment webhook can land a moment
 * later than the sheet closes, so it asks again a few times while the payment is pending.
 */
export async function settleCheckout(finish: () => Promise<CheckoutOutcome>) {
  let outcome = await finish();
  for (let attempt = 0; outcome.status === "pending" && attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    outcome = await finish();
  }
  return outcome;
}

/** What to tell the customer when a paid checkout didn't become a booking. */
export function outcomeProblem(outcome: CheckoutOutcome): string | null {
  switch (outcome.status) {
    case "booked":
    case "requested":
      return null;
    case "refunded":
      return `${outcome.message} Your payment has been refunded.`;
    case "expired":
      return "Your hold on that time ran out before the payment finished. Pick a time again.";
    case "pending":
      return "We're still confirming your payment. Your booking will show in Bookings shortly.";
    default:
      return "Something went wrong with this payment. Please try again.";
  }
}
