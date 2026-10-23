import {
  bookFirstService,
  confirmEmail,
  expect,
  latestMessage,
  messageWith,
  publishBusiness,
  seriousViolations,
  signUpWithEmail,
  test,
} from "../fixtures.ts";

// Owner, crew member and customer each need their own browser session.
test.describe("bookings (SPEC §19)", () => {
  test.describe.configure({ timeout: 240_000 });

  test("instant booking: pay, assign crew, set up payouts, cancel for a refund", async ({
    page,
    newVisitor,
    uniq,
  }) => {
    const name = `Sunrise Lawns ${uniq.key}`;
    const proPath = await publishBusiness(page, { email: uniq.email, name, instantBook: true });

    // The owner invites a crew member from the Team page.
    const crewEmail = `crew-${uniq.email}`;
    const tabs = page.getByRole("navigation", { name: "Business mode" });
    await tabs.getByRole("link", { name: "Team" }).click();
    await expect(page.getByRole("heading", { name: "Your team" })).toBeVisible();
    await page.getByLabel("Email").fill(crewEmail);
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByText(`Invite sent to ${crewEmail}.`)).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    // The crew member signs up from the invite link, confirms their email and joins.
    const crew = await newVisitor("crew");
    const invite = await latestMessage(crewEmail);
    const inviteLink = invite.links.find((url) => url.includes("/invite/")) as string;
    await crew.goto(inviteLink);
    await expect(crew.getByRole("heading", { name: `Join ${name}` })).toBeVisible();
    await crew.getByRole("main").getByRole("link", { name: "Create an account" }).click();
    await crew.getByLabel("Your name").fill("Cal Crew");
    await crew.getByRole("textbox", { name: "Email" }).fill(crewEmail);
    await crew.getByLabel("Postal code").fill("B3H 1A1");
    await crew.getByLabel("Password", { exact: true }).fill("correct-horse-battery");
    await crew.getByLabel("Confirm password").fill("correct-horse-battery");
    await crew.getByRole("button", { name: "Create account" }).click();
    await expect(crew).toHaveURL(/\/invite\//);
    await confirmEmail(crew, crewEmail);
    await crew.goto(inviteLink);
    await crew.getByRole("button", { name: "Accept invite" }).click();
    await expect(crew).toHaveURL(/\/business\/calendar/);
    await expect(crew.getByRole("heading", { name: "Your jobs" })).toBeVisible();
    // Crew don't see payouts.
    await expect(
      crew
        .getByRole("navigation", { name: "Business mode" })
        .getByRole("link", { name: "Payouts" }),
    ).toHaveCount(0);

    // A customer books and pays: Instant Book confirms straight away.
    const customer = await newVisitor("customer");
    const customerEmail = `customer-${uniq.email}`;
    await signUpWithEmail(customer, { email: customerEmail, name: "Cora Customer" });
    await expect(customer).toHaveURL(/\/welcome/);
    await confirmEmail(customer, customerEmail);
    await bookFirstService(customer, proPath);
    await expect(customer.getByText("$64.53")).toBeVisible();
    expect(await seriousViolations(customer)).toEqual([]);
    await customer.getByRole("button", { name: "Pay with test card" }).click();
    await expect(customer).toHaveURL(/\/bookings\/[0-9a-f-]+\?new=1/);
    await expect(customer.getByText("You're booked. We've emailed you a receipt.")).toBeVisible();
    await expect(customer.getByText("Booked", { exact: true })).toBeVisible();
    await expect(customer.getByText("Side gate is unlocked.")).toBeVisible();
    expect(await seriousViolations(customer)).toEqual([]);
    const receipt = await messageWith(customerEmail, /^Booked: Weekly mowing/);
    expect(receipt.text).toContain("$64.53");

    // The owner is told, and assigns the job from the calendar.
    await messageWith(uniq.email, /^New booking: Weekly mowing/);
    await messageWith(uniq.email, /^Set up payouts/);
    await page.goto("/business/calendar");
    const needsYou = page.getByRole("region", { name: "Needs you" });
    await expect(needsYou.getByText("Weekly mowing")).toBeVisible();
    await expect(needsYou.getByText(/you get \$58\.20/)).toBeVisible();
    await needsYou.getByLabel("Crew member").selectOption({ label: "Cal Crew" });
    await expect(page.getByRole("region", { name: "Needs you" })).toHaveCount(0);
    expect(await seriousViolations(page)).toEqual([]);

    // The crew member sees it in their week.
    await crew.reload();
    await crew.getByRole("button", { name: "Next week" }).click();
    await expect(crew.getByText("Weekly mowing")).toBeVisible();
    await expect(crew.getByText("“Side gate is unlocked.”")).toBeVisible();

    // The first paid booking starts the 7-day payout setup clock.
    await tabs.getByRole("link", { name: "Payouts" }).click();
    await expect(page.getByText(/Finish by .* to keep taking bookings/)).toBeVisible();
    await expect(page.getByText("$58.20")).toBeVisible();
    await page.getByRole("button", { name: "Set up payouts" }).click();
    await expect(page.getByRole("heading", { name: "Test payout setup" })).toBeVisible();
    await page.getByRole("button", { name: "Finish test setup" }).click();
    await expect(page).toHaveURL(/\/business\/payouts\?done=1/);
    await expect(page.getByRole("heading", { name: "Payouts are set up" })).toBeVisible();

    // A week out, the customer can cancel for free (the service fee isn't refunded).
    await customer.goto("/bookings");
    await customer
      .getByRole("link", { name: /Weekly mowing/ })
      .first()
      .click();
    await customer.getByRole("button", { name: "Cancel booking" }).click();
    await expect(customer.getByText(/Free cancellation: you get \$60\.00 back/)).toBeVisible();
    await customer.getByRole("button", { name: "Cancel booking" }).click();
    await expect(customer.getByText("Cancelled by you")).toBeVisible();
    await expect(customer.getByText("Refunded")).toBeVisible();
  });

  test("request: the card is held, the pro accepts, then cancels with a full refund", async ({
    page,
    newVisitor,
    uniq,
  }) => {
    const name = `Harbour Yards ${uniq.key}`;
    const proPath = await publishBusiness(page, { email: uniq.email, name, instantBook: false });

    const customer = await newVisitor("customer");
    const customerEmail = `customer-${uniq.email}`;
    await signUpWithEmail(customer, { email: customerEmail, name: "Cora Customer" });
    await expect(customer).toHaveURL(/\/welcome/);
    await confirmEmail(customer, customerEmail);

    // Outside the service area: refused before any payment.
    await customer.goto(proPath);
    await customer.getByRole("link", { name: "Book a time" }).click();
    await customer.getByRole("button", { name: "Later" }).click();
    await expect(customer.getByRole("button", { name: "Earlier" })).toBeEnabled();
    await customer.locator("fieldset button:not([disabled])").first().click();
    await customer.getByRole("radio").and(customer.locator(":not([disabled])")).first().check();
    await customer.getByLabel("Street address").fill("1 Charlotte St");
    await customer.getByLabel("Town or city").fill("Sydney");
    await customer.getByLabel("Postal code").fill("B1P 1A1");
    await customer.getByRole("button", { name: /Continue to payment/ }).click();
    await expect(
      customer.getByText(`That address is outside ${name}'s service area.`),
    ).toBeVisible();

    // A request holds the card instead of charging it.
    await bookFirstService(customer, proPath);
    await expect(customer.getByText("Hold on card")).toBeVisible();
    await customer.getByRole("button", { name: "Authorize test card" }).click();
    await expect(customer).toHaveURL(/\/bookings\/[0-9a-f-]+\?new=1/);
    await expect(customer.getByText(/Request sent\. .* has 24 hours to accept/)).toBeVisible();
    await expect(customer.getByText("Waiting for the pro")).toBeVisible();
    await expect(customer.getByText("Held on your card")).toBeVisible();
    const bookingUrl = customer.url().replace("?new=1", "");

    // The owner accepts from the calendar inbox.
    await page.goto("/business/calendar");
    const needsYou = page.getByRole("region", { name: "Needs you" });
    await expect(needsYou.getByText("Request: accept or decline")).toBeVisible();
    // No contact details until the booking is paid.
    await expect(needsYou.getByText(customerEmail)).toHaveCount(0);
    await needsYou.getByRole("button", { name: "Accept" }).click();
    await expect(needsYou.getByText("Booked")).toBeVisible();
    await expect(needsYou.getByText(customerEmail)).toBeVisible();

    await customer.goto(bookingUrl);
    await expect(customer.getByText("Booked", { exact: true })).toBeVisible();
    await expect(customer.getByText("Held on your card")).toHaveCount(0);

    // The pro cancels: the customer gets everything back, service fee included.
    await needsYou.getByRole("button", { name: "Cancel job" }).click();
    await needsYou.getByLabel(/Why are you cancelling/).fill("Our mower broke down, sorry.");
    await needsYou.getByRole("button", { name: "Cancel and refund" }).click();
    await expect(page.getByRole("region", { name: "Needs you" })).toHaveCount(0);

    await customer.reload();
    await expect(customer.getByText("Cancelled by the pro")).toBeVisible();
    await expect(
      customer.getByText(`${name} cancelled: “Our mower broke down, sorry.”`),
    ).toBeVisible();
    await expect(customer.getByRole("complementary", { name: "Payment" })).toContainText(
      /Refunded\s*\$64\.53/,
    );
    const mail = await messageWith(customerEmail, /^Cancelled:/);
    expect(mail.text).toContain("Our mower broke down, sorry.");
    expect(mail.text).toContain("Refund: $64.53");
  });

  test("the scheduled jobs endpoint needs its secret", async ({ request }) => {
    expect((await request.get("/api/cron")).status()).toBe(401);
    const wrong = await request.get("/api/cron", { headers: { authorization: "Bearer nope" } });
    expect(wrong.status()).toBe(401);
    const ok = await request.get("/api/cron", {
      headers: { authorization: "Bearer e2e-only-cron-secret-0123456789abcdef" },
    });
    expect(ok.status()).toBe(200);
  });
});
