import type { Instrumentation } from "next";
import { assertValidEnv } from "@/lib/env.ts";

/**
 * Runs once when the server starts (not during `next build`): check the settings, then
 * start error reporting if a Sentry DSN is configured (SPEC §17). Without a DSN nothing
 * is loaded or sent.
 */
export async function register() {
  assertValidEnv();
  if (process.env.SENTRY_DSN && process.env.NEXT_RUNTIME === "nodejs") {
    const Sentry = await import("@sentry/nextjs");
    const { sharedSentryOptions } = await import("@/lib/sentry-options.ts");
    Sentry.init({ dsn: process.env.SENTRY_DSN, ...sharedSentryOptions });
  }
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
