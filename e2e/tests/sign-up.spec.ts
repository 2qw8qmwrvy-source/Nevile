import { expect, latestMessage, signUpWithEmail, test } from "../fixtures.ts";

test.describe("sign-up (Nova Scotia only)", () => {
  test("blocks postal codes outside Nova Scotia in the form", async ({ page, uniq }) => {
    await signUpWithEmail(page, { email: uniq.email, postalCode: "K1A 0B1" });
    await expect(page.getByText("Nevile is only in Nova Scotia for now.").first()).toBeVisible();
    await expect(page).toHaveURL(/\/sign-up/);
  });

  test("the server refuses non-Nova Scotia sign-ups too", async ({ page, uniq }) => {
    await page.goto("/");
    const response = await page.request.post("/api/auth/sign-up/email", {
      headers: { origin: new URL(page.url()).origin },
      data: {
        name: "Outside",
        email: uniq.email,
        password: "correct-horse-battery",
        postalCode: "V6B 1A1",
      },
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ code: "NOT_IN_SERVICE_AREA" });
  });

  test("marketing consent starts unticked", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByRole("checkbox", { name: /Send me tips/ })).not.toBeChecked();
  });

  test("signs in straight away, then the email link unlocks business mode", async ({
    page,
    uniq,
  }) => {
    await signUpWithEmail(page, { email: uniq.email });
    await expect(page).toHaveURL(/\/welcome/);
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page).toHaveURL(/\/$/);

    const banner = page.getByRole("complementary", { name: "Confirm your email" });
    await expect(banner).toBeVisible();

    await page.goto("/account");
    await expect(page.getByText("Confirm your email to switch to business mode.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Switch to business mode" })).toHaveCount(0);

    const mail = await latestMessage(uniq.email);
    const link = mail.links.find((url) => url.includes("/verify-email"));
    expect(link).toBeTruthy();
    await page.goto(link as string);
    await expect(page.getByRole("heading", { name: "You're all set" })).toBeVisible();
    await page.getByRole("link", { name: "Continue" }).click();
    await expect(banner).toHaveCount(0);

    await page.goto("/account");
    await expect(page.getByRole("button", { name: "Switch to business mode" })).toBeVisible();
  });

  test("phone sign-up asks a new number for a postal code", async ({ page, uniq }) => {
    await page.goto("/sign-in?method=phone");
    await page.getByLabel("Mobile number").fill(uniq.phone);
    await page.getByRole("button", { name: "Text me a code" }).click();
    const sms = await latestMessage(uniq.phone);
    expect(sms.code).toMatch(/^\d{6}$/);
    await page.getByRole("textbox", { name: "Code" }).fill(sms.code as string);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText(/Add your postal code to create your account/)).toBeVisible();
    await page.getByLabel("Postal code").fill("V6B 1A1");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Nevile is only in Nova Scotia for now.").first()).toBeVisible();

    await page.getByLabel("Postal code").fill("B4N 2A1");
    await expect(page.getByRole("checkbox", { name: /Send me tips/ })).not.toBeChecked();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/welcome/);
  });
});
