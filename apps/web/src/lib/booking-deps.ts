import "server-only";
import { type BookingDeps, defaultEmailSender, defaultPushSender, getApiConfig } from "@nevile/api";
import { db } from "@nevile/db";
import { FakePaymentProvider, getPaymentProvider, lazyPaymentProvider } from "@nevile/payments";

/** Booking dependencies for route handlers (webhooks, scheduled jobs, dev pages). */
export function serverBookingDeps(): BookingDeps {
  return {
    db,
    payments: lazyPaymentProvider,
    email: defaultEmailSender,
    push: defaultPushSender,
    config: getApiConfig(),
    now: () => new Date(),
  };
}

/** The fake payment provider, when this environment uses it (never in production). */
export function fakePayments(): FakePaymentProvider | null {
  if (process.env.NODE_ENV === "production") return null;
  const provider = getPaymentProvider();
  return provider instanceof FakePaymentProvider ? provider : null;
}
