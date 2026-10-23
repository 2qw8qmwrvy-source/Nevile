import { expect, latestMessage, seriousViolations, signUpWithEmail, test } from "../fixtures.ts";

// A 1×1 PNG; the server re-encodes it as WebP like any other photo.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("listings and search", () => {
  test("a business builds and publishes a listing that customers can find", async ({
    page,
    newVisitor,
    uniq,
  }) => {
    const name = `Bedford Lawns ${uniq.key}`;

    // Sign up, confirm the email and switch to business mode.
    await signUpWithEmail(page, { email: uniq.email, name: "Bea Owner" });
    await expect(page).toHaveURL(/\/welcome/);
    const mail = await latestMessage(uniq.email);
    await page.goto(mail.links.find((url) => url.includes("/verify-email")) as string);
    await expect(page.getByRole("heading", { name: "You're all set" })).toBeVisible();
    await page.goto("/account?intent=business");
    await page.getByLabel("Business name").fill(name);
    await page.getByRole("button", { name: "Create business and switch" }).click();
    await page.getByRole("link", { name: "Manage your listing" }).click();

    // Start: nothing published, a checklist of what's missing.
    await expect(page).toHaveURL(/\/business/);
    await expect(page.getByRole("heading", { name: "Get ready to publish" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Set your service area/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish listing" })).toBeDisabled();

    // Profile.
    await page
      .getByLabel("About your business")
      .fill("Family-run lawn crew serving Bedford, Sackville and Halifax for ten years.");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();

    // A work photo.
    await page.getByLabel("Add photos").setInputFiles({
      name: "lawn.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    await expect(page.getByText("(1 of 8)")).toBeVisible();
    await page.getByLabel("Describe this photo").fill("Striped lawn in Bedford");
    await page.getByLabel("Describe this photo").blur();

    // Service area from a postal code (the map is optional).
    await page.getByLabel("Start from a postal code").fill("B4A 1A1");
    await page.getByRole("button", { name: "Move pin there" }).click();
    await page.getByRole("button", { name: "Save service area" }).click();
    await expect(page.getByText("Service area saved.")).toBeVisible();
    await expect(page.getByText("Serves about 25 km around Bedford")).toBeVisible();

    // A fixed-price service; a quote with a fixed price is impossible in the form.
    await page.getByRole("button", { name: "Add a service" }).click();
    await page.getByLabel("Category").selectOption("lawn-mowing");
    await page.getByLabel("Service name").fill("Weekly mowing");
    await page.getByLabel("Price per visit ($)").fill("abc");
    await page.getByRole("button", { name: "Add service" }).click();
    await expect(page.getByText("Enter the price per visit, like 60 or 60.50.")).toBeVisible();
    await page.getByLabel("Price per visit ($)").fill("60");
    await page.getByRole("button", { name: "Add service" }).click();
    await expect(page.getByText(/Lawn Mowing · \$60 \/ visit/)).toBeVisible();

    // Publish.
    await expect(page.getByRole("heading", { name: "Ready to publish" })).toBeVisible();
    await page.getByRole("button", { name: "Publish listing" }).click();
    await expect(page.getByRole("heading", { name: "Your listing is live" })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    // A customer (not signed in) finds it from a Halifax postal code.
    const visitor = await newVisitor("customer");
    await visitor.goto("/search?service=lawn-mowing&postal=B3H%201A1");
    await expect(visitor.getByText("Near B3H · Halifax (South End)")).toBeVisible();
    const result = visitor.getByRole("link", { name: new RegExp(name) });
    await expect(result).toBeVisible();
    await expect(result).toContainText("$60 / visit");
    await expect(result).toContainText("New on Nevile");
    await result.click();

    // Its public page: no contact details; fixed-price services can be booked.
    await expect(visitor.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(visitor.getByText("Serves about 25 km around Bedford").first()).toBeVisible();
    await expect(visitor.getByRole("img", { name: "Striped lawn in Bedford" })).toBeVisible();
    await expect(visitor.getByRole("link", { name: "Book a time" })).toBeVisible();
    await expect(visitor.getByText(uniq.email)).toHaveCount(0);
    expect(await seriousViolations(visitor)).toEqual([]);

    // Too far away: Sydney customers don't see a 25 km Bedford business.
    await visitor.goto("/search?service=lawn-mowing&postal=B1P");
    await expect(visitor.getByRole("link", { name: new RegExp(name) })).toHaveCount(0);

    // Unpublishing hides it straight away.
    await page.getByRole("button", { name: "Unpublish" }).click();
    await expect(page.getByRole("heading", { name: "Ready to publish" })).toBeVisible();
    await visitor.goto("/search?service=lawn-mowing&postal=B3H%201A1");
    await expect(visitor.getByRole("link", { name: new RegExp(name) })).toHaveCount(0);
  });

  test("search explains postal codes it can't use", async ({ page }) => {
    await page.goto("/search?postal=M5V%202T6");
    await expect(
      page.getByRole("heading", { name: "Nevile is only in Nova Scotia for now" }),
    ).toBeVisible();

    await page.goto("/search");
    await page.getByLabel("Postal code").fill("hello");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByText("Enter a postal code like B3H 1A1.")).toBeVisible();

    await page.getByLabel("Postal code").fill("B3W 1A1");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByText(/We don't have B3W on file yet/)).toBeVisible();
  });
});
