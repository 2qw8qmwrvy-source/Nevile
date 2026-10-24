import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import {
  type BrowserContext,
  test as base,
  expect,
  type Page,
  type TestInfo,
} from "@playwright/test";

export { expect };

const OUTBOX_DIR = resolve(import.meta.dirname, ".outbox");

type OutboxMessage = { to: string; subject?: string; text: string; links: string[]; code?: string };

/** A stable value unique to this test, project and retry. */
function testKey(testInfo: TestInfo): Buffer {
  return createHash("sha256")
    .update(`${testInfo.testId}|${testInfo.project.name}|${testInfo.retry}|${Date.now()}`)
    .digest();
}

/** A made-up client address for one visitor, so per-IP auth rate limits stay separate. */
function visitorAddress(digest: Buffer): string {
  return `10.${digest[0]}.${digest[1]}.${((digest[2] ?? 0) % 250) + 1}`;
}

type Fixtures = {
  uniq: { email: string; phone: string; key: string };
  /** Another person in their own browser session (and client address). */
  newVisitor: (label: string) => Promise<Page>;
};

export const test = base.extend<Fixtures>({
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
    await page.setExtraHTTPHeaders({ "x-forwarded-for": visitorAddress(digest) });
    await use(page);
  },
  newVisitor: async ({ browser }, use, testInfo) => {
    const contexts: BrowserContext[] = [];
    const key = testKey(testInfo).toString("hex");
    await use(async (label) => {
      const digest = createHash("sha256").update(`${key}|${label}`).digest();
      const { viewport, isMobile, hasTouch, deviceScaleFactor } = testInfo.project.use;
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch,
        deviceScaleFactor,
        extraHTTPHeaders: { "x-forwarded-for": visitorAddress(digest) },
      });
      contexts.push(context);
      return context.newPage();
    });
    for (const context of contexts) await context.close();
  },
});

/** The newest outbox message for an address or phone number, waiting for it to arrive. */
export function latestMessage(to: string): Promise<OutboxMessage> {
  return messageWith(to, /(?:)/);
}

/** The newest outbox message to `to` whose subject matches, waiting for it to arrive. */
export async function messageWith(to: string, subject: RegExp): Promise<OutboxMessage> {
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
              // Phone numbers match on digits; email addresses exactly.
              (message.to === to ||
                (!to.includes("@") &&
                  message.to.replace(/\D/g, "").endsWith(to.replace(/\D/g, "")))) &&
              subject.test(message.subject ?? ""),
          );
        found = messages.at(-1);
        return Boolean(found);
      },
      { timeout: 20_000, message: `no outbox message for ${to} matching ${subject}` },
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
  // Typing before the page is interactive can be undone when it hydrates.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Postal code").fill(postalCode);
  await page.getByLabel("Password", { exact: true }).fill("correct-horse-battery");
  await page.getByLabel("Confirm password").fill("correct-horse-battery");
  await expect(page.getByLabel("Postal code")).toHaveValue(postalCode);
  await page.getByRole("button", { name: "Create account" }).click();
}

/**
 * Horizontal overflow in CSS pixels (0 means no sideways scrolling), measured against the
 * device width: on phones an overflowing page widens the layout viewport itself, so
 * comparing with `innerWidth` alone would miss it.
 */
export async function horizontalOverflow(page: Page): Promise<number> {
  const deviceWidth = page.viewportSize()?.width ?? 0;
  const width = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, window.innerWidth),
  );
  return Math.max(0, width - deviceWidth);
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

/** WCAG 2.1 A/AA problems axe rates serious or critical, as readable strings. */
export async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    // The Next.js dev overlay is not part of the site.
    .exclude("nextjs-portal")
    .analyze();
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
    );
}

/** Opens the confirmation link from the newest email to `email`. */
export async function confirmEmail(page: Page, email: string) {
  const mail = await latestMessage(email);
  const link = mail.links.find((url) => url.includes("/verify-email"));
  if (!link) throw new Error(`no confirmation link for ${email}`);
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "You're all set" })).toBeVisible();
}

/**
 * Signs up a business owner and publishes a listing with one $60 fixed-price service in
 * Bedford (25 km area, which covers Halifax). Returns the public page path.
 */
export async function publishBusiness(
  page: Page,
  { email, name, instantBook }: { email: string; name: string; instantBook: boolean },
): Promise<string> {
  await signUpWithEmail(page, { email, name: "Bea Owner" });
  await expect(page).toHaveURL(/\/welcome/);
  await confirmEmail(page, email);
  await page.goto("/account?intent=business");
  await page.getByLabel("Business name").fill(name);
  await page.getByRole("button", { name: "Create business and switch" }).click();
  await page.getByRole("link", { name: "Manage your listing" }).click();
  await expect(page.getByRole("heading", { name: "Get ready to publish" })).toBeVisible();

  await page
    .getByLabel("About your business")
    .fill("Family-run lawn crew serving Bedford, Sackville and Halifax for ten years.");
  if (instantBook) {
    // The styled checkbox is ticked through its label (as a person would).
    await page.locator("label", { hasText: "Instant Book" }).click();
    await expect(page.getByRole("checkbox", { name: /Instant Book/ })).toBeChecked();
  }
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();

  await page.getByLabel("Start from a postal code").fill("B4A 1A1");
  await page.getByRole("button", { name: "Move pin there" }).click();
  await page.getByRole("button", { name: "Save service area" }).click();
  await expect(page.getByText("Service area saved.")).toBeVisible();

  await page.getByRole("button", { name: "Add a service" }).click();
  await page.getByLabel("Category").selectOption("lawn-mowing");
  await page.getByLabel("Service name").fill("Weekly mowing");
  await page.getByLabel("Price per visit ($)").fill("60");
  await page.getByRole("button", { name: "Add service" }).click();
  await expect(page.getByText(/Lawn Mowing · \$60 \/ visit/)).toBeVisible();

  await page.getByRole("button", { name: "Publish listing" }).click();
  await expect(page.getByRole("heading", { name: "Your listing is live" })).toBeVisible();
  const href = await page.getByRole("link", { name: "View your page" }).getAttribute("href");
  if (!href) throw new Error("no public page link");
  return href;
}

/**
 * As a signed-in, confirmed customer: books the pro's first service on the first open day
 * a week out (so cancelling is free), paying on the test checkout page.
 */
export async function bookFirstService(page: Page, proPath: string) {
  await page.goto(proPath);
  await page.getByRole("link", { name: "Book a time" }).click();
  await expect(page.getByRole("heading", { name: "When" })).toBeVisible();
  await page.getByRole("button", { name: "Later" }).click();
  // The next page of days has loaded once "Earlier" works.
  await expect(page.getByRole("button", { name: "Earlier" })).toBeEnabled();
  await page.locator("fieldset button:not([disabled])").first().click();
  await page.getByRole("radio").and(page.locator(":not([disabled])")).first().check();
  await page.getByLabel("Street address").fill("1 Spring Garden Rd");
  await page.getByLabel("Town or city").fill("Halifax");
  await page.getByLabel("Postal code").fill("B3H 1A1");
  await page.getByLabel("Notes for the pro (optional)").fill("Side gate is unlocked.");
  await expect(page.getByRole("complementary", { name: "Summary" })).toContainText("$64.53");
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  await expect(page.getByRole("heading", { name: "Test payment" })).toBeVisible();
}
