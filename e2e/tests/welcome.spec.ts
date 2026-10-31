import { expect, signUpWithEmail, test } from "../fixtures.ts";

test.describe("welcome flow", () => {
  test("three steps save intent, postal code and interests", async ({ page, uniq }) => {
    await signUpWithEmail(page, { email: uniq.email, postalCode: "b3h1a1" });
    await expect(page).toHaveURL(/\/welcome/);
    await expect(page.getByText("Step 1 of 3")).toBeVisible();

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Choose one to continue.")).toBeVisible();
    await page.getByText("I need help at home").click();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText("Step 2 of 3")).toBeVisible();
    await expect(page.getByLabel("Postal code")).toHaveValue("B3H 1A1");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText("Step 3 of 3")).toBeVisible();
    const snow = page.getByRole("button", { name: /Snow & Ice Removal/ });
    await snow.click();
    await expect(snow).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/account");
    await expect(page.getByText("B3H 1A1")).toBeVisible();
    await expect(page.getByText("Snow & Ice Removal", { exact: true })).toBeVisible();
  });

  test("can be skipped and keeps the sign-up postal code", async ({ page, uniq }) => {
    await signUpWithEmail(page, { email: uniq.email, postalCode: "B2Y 4G2" });
    await expect(page).toHaveURL(/\/welcome/);
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/account");
    await expect(page.getByText("B2Y 4G2")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Send me tips/ })).not.toBeChecked();
  });
});
