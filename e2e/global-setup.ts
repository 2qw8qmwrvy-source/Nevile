import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { FullConfig } from "@playwright/test";

/**
 * Pages compiled on first visit in development can take longer than a test's timeouts
 * when two workers hit them at once, so each route is requested once before the tests.
 * Signed-out requests redirect, which still compiles the page.
 */
const WARM_UP_PATHS = [
  "/",
  "/search?service=lawn-mowing&postal=B3H%201A1",
  "/sign-up",
  "/sign-in",
  "/welcome",
  "/account",
  "/verify-email",
  "/business",
  "/business/calendar",
  "/business/quotes",
  "/business/quotes/00000000-0000-4000-8000-000000000000",
  "/business/team",
  "/business/payouts",
  "/bookings",
  "/bookings/00000000-0000-4000-8000-000000000000",
  "/bookings/return",
  "/quotes",
  "/quotes/new",
  "/quotes/00000000-0000-4000-8000-000000000000",
  "/quotes/00000000-0000-4000-8000-000000000000/book",
  "/inbox",
  "/inbox/00000000-0000-4000-8000-000000000000",
  "/invite/warm-up-token-0000000000",
  "/pros/warm-up",
  "/pros/warm-up/book",
  "/dev/fake-checkout/warm-up",
  "/dev/fake-card/warm-up",
  "/account/card",
  "/account/card/return",
  "/pros/warm-up/recurring",
  "/pros/warm-up/contract",
  "/business/snow-route",
  "/business/bookings/00000000-0000-4000-8000-000000000000",
  "/dev/fake-onboarding",
  "/neighbours",
  "/privacy",
];

async function warmUp(baseURL: string): Promise<void> {
  try {
    await fetch(`${baseURL}/api/health`);
  } catch {
    return; // No server yet (Playwright starts it): nothing to warm.
  }
  for (const path of WARM_UP_PATHS) {
    await fetch(`${baseURL}${path}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(120_000),
    }).catch(() => undefined);
  }
}

/** Fresh database, an empty outbox and no uploaded media before every run. */
export default async function globalSetup(config: FullConfig) {
  await resetEverything();
  await warmUp(config.projects[0]?.use.baseURL ?? "http://localhost:3100");
}

function resetEverything() {
  const databaseUrl =
    process.env.E2E_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://nevile:nevile@localhost:5432/nevile_e2e";
  execFileSync("pnpm", ["--filter", "@nevile/db", "run", "reset:e2e"], {
    cwd: resolve(import.meta.dirname, ".."),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
  const outbox = resolve(import.meta.dirname, ".outbox");
  rmSync(outbox, { recursive: true, force: true });
  mkdirSync(outbox, { recursive: true });
  rmSync(resolve(import.meta.dirname, ".media"), { recursive: true, force: true });
}
