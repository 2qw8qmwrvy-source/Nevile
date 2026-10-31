import { expect, expectedSeason, horizontalOverflow, test } from "../fixtures.ts";

test.describe("homepage", () => {
  test("follows the current Nova Scotia season with no manual switcher", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-season", expectedSeason());
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // SPEC §13: no season buttons of any kind.
    for (const label of ["Winter", "Spring", "Summer", "Fall"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
      await expect(page.getByRole("radio", { name: label, exact: true })).toHaveCount(0);
    }
    await expect(page.getByText(/Nova Scotia/).first()).toBeVisible();
    await expect(page.getByText(/Ottawa|Ontario|Toronto/)).toHaveCount(0);
  });

  test("shows the end-of-season nudge only in a season's last month", async ({ page }) => {
    await page.goto("/");
    const month = Number(
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/Halifax", month: "numeric" }).format(
        new Date(),
      ),
    );
    const nudge = page.getByText("Coming up", { exact: true });
    if ([3, 5, 8, 11].includes(month)) await expect(nudge).toBeVisible();
    else await expect(nudge).toHaveCount(0);
  });

  test("example checkout uses the Nova Scotia true-6% numbers", async ({ page }) => {
    await page.goto("/");
    const receipt = page.getByRole("complementary", { name: /one-off lawn mow in Nova Scotia/i });
    await expect(receipt).toContainText("$60.00");
    await expect(receipt).toContainText("$4.22");
    await expect(receipt).toContainText("HST (14%)");
    await expect(receipt).toContainText("$8.99");
    await expect(receipt).toContainText("$73.21");
  });

  test("has no sideways scrolling", async ({ page }) => {
    for (const path of ["/", "/for-businesses", "/neighbours", "/sign-up", "/privacy"]) {
      await page.goto(path);
      expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
    }
  });
});

test("health check reports ok", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: "ok", db: "ok" });
  expect(response.headers()["cache-control"]).toContain("no-store");
});

test("unknown pages get a friendly 404", async ({ page }) => {
  const response = await page.goto("/this-page-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
