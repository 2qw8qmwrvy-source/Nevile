import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";

export { expect };

const OUTBOX_DIR = resolve(import.meta.dirname, ".outbox");

type OutboxMessage = { to: string; subject?: string; text: string; links: string[]; code?: string };

/** A stable value unique to this test, project and retry. */
function testKey(testInfo: TestInfo): Buffer {
  return createHash("sha256")
    .update(`${testInfo.testId}|${testInfo.project.name}|${testInfo.retry}|${Date.now()}`)
    .digest();
}

export const test = base.extend<{ uniq: { email: string; phone: string; key: string } }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured first argument.
  uniq: async ({}, use, testInfo) => {
    const digest = testKey(testInfo);
    const key = digest.toString("hex").slice(0, 10);
    // 902 is a Nova Scotia area code; the exchange avoids 0/1 starts and N11 codes.
    const exchange = 200 + (digest.readUInt16BE(0) % 700);
    const line = String(digest.readUInt16BE(2) % 10_000).padStart(4, "0");
    await use({
      email: `e2e-${key}@example.com`,
      phone: `902${exchange % 100 === 11 ? exchange + 1 : exchange}${line}`,
      key,
    });
  },
  // Each test looks like a different visitor, so auth rate limits (per client IP) don't
  // carry over between tests. In development the server reads X-Forwarded-For as is.
  page: async ({ page }, use, testInfo) => {
    const digest = testKey(testInfo);
    await page.setExtraHTTPHeaders({
      "x-forwarded-for": `10.${digest[0]}.${digest[1]}.${((digest[2] ?? 0) % 250) + 1}`,
    });
    await use(page);
  },
});

/** The newest outbox message for an address or phone number, waiting for it to arrive. */
export async function latestMessage(to: string): Promise<OutboxMessage> {
  let found: OutboxMessage | undefined;
  await expect
    .poll(
      () => {
        const files = readdirSync(OUTBOX_DIR)
          .filter((file) => file.endsWith(".json"))
          .sort();
        const messages = files
          .map(
            (file) => JSON.parse(readFileSync(resolve(OUTBOX_DIR, file), "utf8")) as OutboxMessage,
          )
          .filter(
            (message) =>
              message.to === to || message.to.replace(/\D/g, "").endsWith(to.replace(/\D/g, "")),
          );
        found = messages.at(-1);
        return Boolean(found);
      },
      { timeout: 20_000, message: `no outbox message for ${to}` },
    )
    .toBe(true);
  return found as OutboxMessage;
}

export async function signUpWithEmail(
  page: Page,
  {
    email,
    postalCode = "B3H 1A1",
    name = "Test Neighbour",
  }: { email: string; postalCode?: string; name?: string },
) {
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Postal code").fill(postalCode);
  await page.getByLabel("Password", { exact: true }).fill("correct-horse-battery");
  await page.getByLabel("Confirm password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
}

/** Horizontal overflow in CSS pixels (0 means no sideways scrolling). */
export function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/** The season SPEC §13 expects for today in Nova Scotia. */
export function expectedSeason(now = new Date()): "winter" | "spring" | "summer" | "fall" {
  const month = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Halifax", month: "numeric" }).format(now),
  );
  if (month === 12 || month <= 3) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "fall";
}
