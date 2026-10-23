import { expect, seriousViolations, signUpWithEmail, test } from "../fixtures.ts";

const PUBLIC_PAGES = [
  "/",
  "/sign-up",
  "/sign-in",
  "/neighbours",
  "/neighbours/impact",
  "/privacy",
  "/accessibility",
  "/for-businesses",
  "/search",
  "/search?service=lawn-mowing&postal=B3H%201A1",
];

for (const path of PUBLIC_PAGES) {
  test(`no serious accessibility problems on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await seriousViolations(page)).toEqual([]);
  });
}

test("no serious accessibility problems on the welcome flow", async ({ page, uniq }) => {
  await signUpWithEmail(page, { email: uniq.email });
  await expect(page).toHaveURL(/\/welcome/);
  await page.waitForLoadState("networkidle");
  expect(await seriousViolations(page)).toEqual([]);
});

test("animations switch off when reduced motion is requested", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const duration = await page
    .locator(".nv-rise")
    .first()
    .evaluate((element) => getComputedStyle(element).animationDuration);
  expect(Number.parseFloat(duration)).toBeLessThan(0.01);
});
