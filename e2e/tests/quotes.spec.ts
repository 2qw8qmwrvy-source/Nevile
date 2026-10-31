import {
  confirmEmail,
  expect,
  horizontalOverflow,
  messageWith,
  publishBusiness,
  seriousViolations,
  signUpWithEmail,
  test,
} from "../fixtures.ts";

// A 1×1 PNG; the server re-encodes it as WebP like any photo.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("quotes and chat (SPEC §20)", () => {
  test.describe.configure({ timeout: 300_000 });

  test("ask two pros, get a quote and a decline, chat, then book the quote", async ({
    page,
    newVisitor,
    uniq,
  }) => {
    const annName = `Ann's Lawns ${uniq.key}`;
    const benName = `Ben's Yards ${uniq.key}`;
    const annEmail = uniq.email;
    const benEmail = `ben-${uniq.email}`;
    const customerEmail = `customer-${uniq.email}`;

    // Two pros publish lawn listings.
    await publishBusiness(page, { email: annEmail, name: annName, instantBook: false });
    const ben = await newVisitor("ben");
    await publishBusiness(ben, { email: benEmail, name: benName, instantBook: false });

    // The customer picks both from search and asks them for a quote.
    const customer = await newVisitor("customer");
    await signUpWithEmail(customer, { email: customerEmail, name: "Cora Customer" });
    await expect(customer).toHaveURL(/\/welcome/);
    await confirmEmail(customer, customerEmail);
    await customer.goto("/search?service=lawn-mowing&postal=B3H%201A1");
    await customer.getByRole("checkbox", { name: `Ask ${annName} for a quote` }).check();
    await customer.getByRole("checkbox", { name: `Ask ${benName} for a quote` }).check();
    // Signed in, with the quote bar showing: still no sideways scrolling on phones.
    expect(await horizontalOverflow(customer)).toBe(0);
    await customer.getByRole("link", { name: /Ask 2 pros for a quote/ }).click();

    await expect(
      customer.getByRole("heading", { name: "Ask for a quote", level: 1 }),
    ).toBeVisible();
    await expect(customer.getByText(annName)).toBeVisible();
    await expect(customer.getByText(benName)).toBeVisible();
    await customer
      .getByLabel("Describe the job")
      .fill("Front and back lawn, about 400 square metres, overgrown after the summer.");
    await customer.getByRole("radio", { name: "Within a week" }).check();
    await customer.getByLabel("Add photos").setInputFiles({
      name: "lawn.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    await expect(
      customer.getByRole("list", { name: "Photos added" }).getByRole("listitem"),
    ).toHaveCount(1);
    expect(await seriousViolations(customer)).toEqual([]);
    await customer.getByRole("button", { name: "Ask 2 pros for a quote" }).click();
    await expect(customer).toHaveURL(/\/quotes\/[0-9a-f-]+\?new=1/);
    await expect(customer.getByText(/Request sent/)).toBeVisible();
    const quotePage = customer.url().replace("?new=1", "");

    // Ann replies with a quote.
    await messageWith(annEmail, /^Quote request: Lawn Mowing near B3H/);
    await page.goto("/business/quotes");
    await expect(page.getByRole("region", { name: "Needs a reply" })).toContainText(
      "Lawn Mowing · Cora",
    );
    await page.getByRole("link", { name: /Lawn Mowing · Cora/ }).click();
    await expect(page.getByRole("img", { name: "Attachment 1 of 1" })).toBeVisible();
    await page.getByLabel("Price for the job ($)").fill("120");
    await page.getByLabel("How long the job takes").selectOption("120");
    await page
      .getByLabel("What's included (optional)")
      .fill("Mowing, edging and clippings taken away.");
    await page.getByRole("button", { name: "Send quote" }).click();
    await expect(page.getByText("Quote sent. We've emailed the customer.")).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    // Ben declines.
    await ben.goto("/business/quotes");
    await ben.getByRole("link", { name: /Lawn Mowing · Cora/ }).click();
    await ben.getByRole("button", { name: "Can't take it? Decline" }).click();
    await ben.getByLabel("Why can't you take it?").fill("Fully booked this month");
    await ben.getByRole("button", { name: "Decline request" }).click();
    await expect(ben.getByText("You declined: “Fully booked this month”")).toBeVisible();

    // The customer compares and messages Ann; contact details stay hidden from Ann.
    await messageWith(customerEmail, /^Quote from .*: \$120\.00/);
    await customer.goto(quotePage);
    const annCard = customer.getByRole("article", { name: annName });
    await expect(annCard).toContainText("$120.00");
    await expect(annCard).toContainText("Mowing, edging and clippings taken away.");
    await expect(customer.getByRole("article", { name: benName })).toContainText(
      "Their reason: “Fully booked this month”",
    );
    expect(await seriousViolations(customer)).toEqual([]);
    await annCard.getByRole("link", { name: "Message" }).click();
    await customer
      .getByRole("textbox", { name: "Message" })
      .fill("Could you come Tuesday? Call me at 902-555-0142.");
    await customer.getByRole("button", { name: "Send" }).click();
    await expect(customer.getByRole("list", { name: "Messages" })).toContainText("902-555-0142");
    expect(await seriousViolations(customer)).toEqual([]);

    await page.goto("/inbox");
    await page.getByRole("link", { name: /Cora/ }).first().click();
    const annThread = page.getByRole("list", { name: "Messages" });
    await expect(annThread).toContainText("Call me at [hidden until booked].");
    await page.getByRole("textbox", { name: "Message" }).fill("Tuesday works.");
    await page.getByRole("button", { name: "Send" }).click();
    // The customer's open chat picks the reply up by itself.
    await expect(customer.getByRole("list", { name: "Messages" })).toContainText("Tuesday works.");

    // Book the quote: a window, an address in B3H, the test payment page.
    await customer.goto(quotePage);
    await customer
      .getByRole("article", { name: annName })
      .getByRole("link", { name: "Book this quote" })
      .click();
    // First visit compiles the page in development, so allow it time.
    await expect(customer).toHaveURL(/\/book\?quote=/, { timeout: 60_000 });
    await expect(customer.getByRole("heading", { name: "When" })).toBeVisible({ timeout: 60_000 });
    await customer.getByRole("button", { name: "Later" }).click();
    await expect(customer.getByRole("button", { name: "Earlier" })).toBeEnabled();
    await customer.locator("fieldset button:not([disabled])").first().click();
    await customer.getByRole("radio").and(customer.locator(":not([disabled])")).first().check();
    await customer.getByLabel("Street address").fill("1 Spring Garden Rd");
    await customer.getByLabel("Town or city").fill("Halifax");
    await customer.getByLabel("Postal code").fill("B3H 4R2");
    const summary = customer.getByRole("complementary", { name: "Summary" });
    await expect(summary).toContainText("Lawn Mowing (quoted)");
    await expect(summary).toContainText("$120.00");
    await customer.getByRole("button", { name: /Continue to payment/ }).click();
    await customer.getByRole("button", { name: "Pay with test card" }).click();
    await expect(customer).toHaveURL(/\/bookings\/[0-9a-f-]+\?new=1/);
    await expect(customer.getByRole("heading", { name: "Lawn Mowing (quoted)" })).toBeVisible();
    await expect(customer.getByText("Booked", { exact: true })).toBeVisible();

    // Paid: Ann now sees the phone number.
    await page.reload();
    await expect(page.getByRole("list", { name: "Messages" })).toContainText("902-555-0142");
  });

  test("private photos aren't served to people outside the request", async ({ request }) => {
    const response = await request.get("/api/private-media/00000000-0000-4000-8000-000000000000");
    expect(response.status()).toBe(404);
  });

  test("streamed photo uploads (no Content-Length, as Android sends them) are size-capped", async ({
    baseURL,
  }) => {
    const boundary = "nevile-e2e-boundary";
    const multipart = (bytes: Uint8Array) =>
      Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nquotes\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="lawn.png"\r\n` +
            "Content-Type: image/png\r\n\r\n",
        ),
        Buffer.from(bytes),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
    const upload = (body: Buffer) =>
      fetch(`${baseURL}/api/private-uploads`, {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        // A stream has no known length, so it's sent chunked.
        body: new ReadableStream({
          start(controller) {
            for (let start = 0; start < body.length; start += 64 * 1024) {
              controller.enqueue(body.subarray(start, start + 64 * 1024));
            }
            controller.close();
          },
        }),
        duplex: "half",
      } as RequestInit);

    // Read in full and refused only because nobody is signed in.
    const small = await upload(multipart(TINY_PNG));
    expect(small.status).toBe(401);
    // Over 10 MB: refused while reading.
    const large = await upload(multipart(new Uint8Array(11 * 1024 * 1024)));
    expect(large.status).toBe(413);
  });
});
