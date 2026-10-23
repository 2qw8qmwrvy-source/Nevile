import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://nevile:nevile@localhost:5432/nevile_e2e";
export const OUTBOX_DIR = resolve(import.meta.dirname, ".outbox");
export const E2E_CRON_SECRET = "e2e-only-cron-secret-0123456789abcdef";
const MEDIA_DIR = resolve(import.meta.dirname, ".media");

// Locally, an already-installed Chromium can be used instead of downloading one.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

/**
 * Browser tests (SPEC §17). The web app runs in development mode: that is where the dev
 * email/SMS senders write to the outbox the tests read codes and links from. Production
 * builds refuse to start without real senders.
 */
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "phone",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
  ],
  webServer: {
    // A stale Next.js dev cache can put pages in a reload loop, so each run starts clean.
    command: `pnpm --filter @nevile/web exec sh -c "rm -rf .next/dev && exec next dev -p ${PORT}"`,
    url: `${BASE_URL}/api/health`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      DATABASE_URL,
      BETTER_AUTH_SECRET: "e2e-only-secret-0123456789abcdef0123456789abcdef",
      BETTER_AUTH_URL: BASE_URL,
      NEXT_PUBLIC_SITE_URL: BASE_URL,
      NEVILE_DEV_OUTBOX_DIR: OUTBOX_DIR,
      MEDIA_STORAGE: "local",
      MEDIA_LOCAL_DIR: MEDIA_DIR,
      NEVILE_NEIGHBOURS_ENABLED: "false",
      // Bookings use the built-in test payment provider (no Stripe calls).
      PAYMENTS_PROVIDER: "fake",
      CRON_SECRET: E2E_CRON_SECRET,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
