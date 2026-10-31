import { expect, test } from "../fixtures.ts";

test("Nevile Neighbours shows the soft wording and is launching soon", async ({ page }) => {
  await page.goto("/neighbours");
  await expect(page.getByText("Launching soon").first()).toBeVisible();
  await expect(
    page.getByText(
      "We're setting aside donations from our community to help neighbours who can't keep up with their homes.",
    ),
  ).toBeVisible();
  // No fixed percentage promise anywhere on the page (SPEC §15).
  await expect(page.getByText(/\d+\s?% of (every|each|all)/i)).toHaveCount(0);
});

test("the donation preview starts with nothing selected", async ({ page }) => {
  await page.goto("/neighbours");
  const picker = page.getByRole("group", { name: /Donate to Nevile Neighbours/ });
  await expect(picker.getByText("No donation added.")).toBeVisible();
  for (const button of await picker.getByRole("button").all()) {
    await expect(button).toHaveAttribute("aria-pressed", "false");
  }
  await picker.getByRole("button", { name: "Add $2" }).click();
  await expect(picker.getByText("$1.94 goes to the fund after a $0.06 card fee.")).toBeVisible();
  await picker.getByRole("button", { name: "Add $2" }).click();
  await expect(picker.getByText("No donation added.")).toBeVisible();
});

test("the impact page shows zeros before launch", async ({ page }) => {
  await page.goto("/neighbours/impact");
  const totals = page.getByRole("region", { name: "Totals" });
  await expect(totals.getByText("$0.00").first()).toBeVisible();
  await expect(page.getByText("No regions to show yet.")).toBeVisible();
});

test("partner referrals need a signed-in account", async ({ page }) => {
  await page.goto("/partners/refer");
  await expect(page).toHaveURL(
    /\/sign-in\?next=%2Fpartners%2Frefer|\/sign-in\?next=\/partners\/refer/,
  );
});

for (const [path, title, footerLink] of [
  ["/privacy", "Privacy Policy", "Privacy"],
  ["/terms", "Terms of Service", "Terms"],
  ["/accessibility", "Accessibility", "Accessibility"],
] as const) {
  test(`${title} page is marked as a draft and linked from the footer`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText("Draft, pending legal review.")).toBeVisible();
    await expect(
      page.getByRole("contentinfo").getByRole("link", { name: footerLink, exact: true }),
    ).toBeVisible();
  });
}
