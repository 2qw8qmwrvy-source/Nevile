import {
  confirmEmail,
  expect,
  messageWith,
  publishBusiness,
  seriousViolations,
  signUpWithEmail,
  test,
} from "../fixtures.ts";

/** Today in Halifax as YYYY-MM-DD (contract seasons are local dates). */
function halifaxToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Halifax",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** On a page with a "Payment card" section: saves the test card and comes back. */
async function addTestCard(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Add a card" }).first().click();
  await expect(page.getByRole("heading", { name: "Save a test card" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Save test card" }).click();
  await expect(page.getByText(/Card saved/)).toBeVisible();
}

// Owner and customer each need their own browser session.
test.describe("recurring jobs and snow contracts (SPEC §21)", () => {
  test.describe.configure({ timeout: 300_000 });

  test("recurring visits: the pro offers a schedule, the customer requests it, the pro accepts", async ({
    page,
    newVisitor,
    uniq,
  }) => {
    const name = `Tidy Lawns ${uniq.key}`;
    const proPath = await publishBusiness(page, { email: uniq.email, name, instantBook: true });

    // The owner lets customers book the service every week.
    await page.goto("/business");
    await page.getByRole("button", { name: "Edit" }).first().click();
    await page.locator("label", { hasText: "Every week" }).click();
    await page.getByRole("button", { name: "Save service", exact: true }).click();
    await expect(page.getByText(/also every week/)).toBeVisible();

    const customer = await newVisitor("customer");
    const customerEmail = `customer-${uniq.email}`;
    await signUpWithEmail(customer, { email: customerEmail, name: "Cora Customer" });
    await expect(customer).toHaveURL(/\/welcome/);
    await confirmEmail(customer, customerEmail);
    await customer.goto(proPath);
    await customer.getByRole("link", { name: "Book recurring visits" }).click();
    await expect(customer.getByRole("heading", { name: "How often" })).toBeVisible();

    // A saved card comes first; the card page brings them straight back.
    await addTestCard(customer);
    await expect(customer.getByText("Visa •••• 4242")).toBeVisible();

    await customer.locator("fieldset button:not([disabled])").first().click();
    await customer
      .getByRole("radio", { name: /\d.*(am|pm)/ })
      .and(customer.locator(":not([disabled])"))
      .first()
      .check();
    const visits = customer.getByRole("region", { name: "Your visits" });
    await expect(visits.getByText(/Every week · \d+ visits/)).toBeVisible();
    await customer.getByLabel("Street address").fill("1 Spring Garden Rd");
    await customer.getByLabel("Town or city").fill("Halifax");
    await customer.getByLabel("Postal code").fill("B3H 1A1");
    expect(await seriousViolations(customer)).toEqual([]);
    await customer.getByRole("button", { name: "Send request" }).click();
    await expect(customer).toHaveURL(/\/bookings\/[0-9a-f-]+\?new=1/);
    await expect(customer.getByText(/Request sent\. .* nothing is charged/)).toBeVisible();
    await expect(customer.getByText("Waiting for the pro")).toBeVisible();
    const bookingUrl = customer.url().replace("?new=1", "");
    await messageWith(uniq.email, /^Recurring booking request/);

    // The owner accepts from the calendar; the series has its own page.
    await page.goto("/business/calendar");
    const needsYou = page.getByRole("region", { name: "Needs you" });
    await expect(needsYou.getByText(/Every week · \d+ visits/)).toBeVisible();
    await needsYou.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByRole("link", { name: /Every week · visit 1 of/ }).first()).toBeVisible();
    await page
      .getByRole("link", { name: /Every week · visit 1 of/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Weekly mowing" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move" }).first()).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    // The customer sees the visits and skips one that isn't charged yet, for free.
    await customer.goto(bookingUrl);
    await expect(customer.getByText("Booked", { exact: true }).first()).toBeVisible();
    const skip = customer.getByRole("button", { name: "Skip", exact: true });
    await skip.last().click();
    await expect(customer.getByText("Free to skip: it hasn't been charged.")).toBeVisible();
    await customer.getByRole("button", { name: "Skip this visit" }).click();
    await expect(customer.getByText("Cancelled by you")).toBeVisible();
    expect(await seriousViolations(customer)).toEqual([]);
  });

  test("snow contract: listed with spots, signed with the agreement, cleared from the route", async ({
    page,
    newVisitor,
    uniq,
  }) => {
    const name = `Clear Drives ${uniq.key}`;
    const proPath = await publishBusiness(page, { email: uniq.email, name, instantBook: false });

    // The owner lists a snow service as a seasonal contract that has already started.
    await page.goto("/business");
    await page.getByRole("button", { name: "Add a service" }).click();
    await page.getByLabel("Category").selectOption("snow-ice-removal");
    await page.getByLabel("Service name").fill("Driveway clearing");
    await page.getByLabel("Price per visit ($)").fill("40");
    await page.getByRole("button", { name: "Add service" }).click();
    await page.getByRole("button", { name: "Set up a seasonal contract" }).click();
    await page.getByLabel("Season starts").fill(halifaxToday());
    await page.getByLabel("Season price ($)").fill("600");
    await page.getByLabel("Spots").fill("5");
    await page.getByRole("button", { name: "Save contract" }).click();
    await expect(page.getByText(/\$600\.00 for the season/)).toBeVisible();

    const customer = await newVisitor("customer");
    const customerEmail = `customer-${uniq.email}`;
    await signUpWithEmail(customer, { email: customerEmail, name: "Sam Snow" });
    await expect(customer).toHaveURL(/\/welcome/);
    await confirmEmail(customer, customerEmail);
    await customer.goto(proPath);
    await expect(customer.getByText("Seasonal snow contract")).toBeVisible();
    await customer.getByRole("link", { name: "Sign up" }).click();
    await expect(customer.getByRole("heading", { name: "The agreement" })).toBeVisible();
    await addTestCard(customer);

    await customer.locator("label", { hasText: "Monthly" }).click();
    await customer.getByLabel("Street address").fill("40 Snowy Lane");
    await customer.getByLabel("Town or city").fill("Halifax");
    await customer.getByLabel("Postal code").fill("B3H 1A1");
    // Signing needs "I agree".
    await customer.getByRole("button", { name: "Sign up" }).click();
    await expect(customer.getByText(/tick “I agree”/)).toBeVisible();
    await customer.locator("label", { hasText: "I agree to this agreement" }).click();
    expect(await seriousViolations(customer)).toEqual([]);
    await customer.getByRole("button", { name: "Sign up" }).click();
    await expect(customer).toHaveURL(/\/bookings\/[0-9a-f-]+\?new=1/);
    const bookingUrl = customer.url().replace("?new=1", "");
    await expect(
      customer.getByRole("link", { name: "Download the agreement (PDF)" }),
    ).toBeVisible();
    const pdf = await customer.request.get(
      `${bookingUrl.replace("/bookings/", "/api/agreements/")}`,
    );
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    // Nobody else can read it.
    expect(
      (await page.request.get("/api/agreements/00000000-0000-4000-8000-000000000000")).status(),
    ).toBe(404);

    // The owner accepts; the address goes on the snow route.
    await page.goto("/business/calendar");
    await page
      .getByRole("region", { name: "Needs you" })
      .getByRole("button", { name: "Accept" })
      .click();
    await page.goto("/business/snow-route");
    await expect(page.getByText("40 Snowy Lane")).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Cleared" }).click();
    await expect(page.getByText("Logged. The customer has 48 hours to confirm.")).toBeVisible();

    // The customer paid this month on acceptance and confirms the visit.
    await customer.goto(bookingUrl);
    await expect(customer.getByRole("region", { name: "Season payments" })).toContainText("Paid");
    await customer.getByRole("button", { name: "Yes, it's done" }).click();
    await expect(customer.getByText("Completed")).toBeVisible();
  });
});
