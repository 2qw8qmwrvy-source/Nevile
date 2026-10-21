import { describe, expect, it } from "vitest";
import { CONTACT_MASK, containsContactInfo, maskContactInfo } from "./contact-masking.ts";

const M = CONTACT_MASK;

describe("phone numbers", () => {
  it.each([
    "416-555-1234",
    "416.555.1234",
    "416 555 1234",
    "416  555  1234",
    "(416) 555-1234",
    "(416)555-1234",
    "( 416 ) 555 1234",
    "4165551234",
    "+1 416 555 1234",
    "+14165551234",
    "+1-416-555-1234",
    "+1 (416) 555-1234",
    "1-416-555-1234",
    "1 416 555 1234",
    "1 (416) 555-1234",
    "14165551234",
    "1-800-555-0199",
    "416–555–1234", // en dashes
    "416 — 555 — 1234", // em dashes with spaces
    "416 - 555 - 1234",
    "416/555/1234",
    "416_555_1234",
    "416*555*1234",
    "416 555 12 34",
    "4 1 6 5 5 5 1 2 3 4",
    "4-1-6-5-5-5-1-2-3-4",
    "4.1.6.5.5.5.1.2.3.4",
    "4 1 6 . 5 5 5 . 1 2 3 4",
    "416 5 5 5 1 2 3 4",
    "416 5551234",
    "416555 1234",
    "1 4165551234",
    "1416 555 1234",
    "(4165551234)",
    "+44 20 7946 0958", // international with "+"
    "+33 1 23 45 67 89",
  ])("masks %s", (phone) => {
    expect(maskContactInfo(phone)).toBe(M);
  });

  it("masks inside sentences and keeps the surrounding text", () => {
    expect(maskContactInfo("Call me at 416-555-1234 tomorrow.")).toBe(`Call me at ${M} tomorrow.`);
    expect(maskContactInfo("text me:6475559876!")).toBe(`text me:${M}!`);
    expect(maskContactInfo("cell (647) 555-0000, home 905.555.1111")).toBe(`cell ${M}, home ${M}`);
  });

  it("masks every number in a multi-line message", () => {
    const text = "Hi!\nMy cell: 416 555 1234\nWork: +1 (905) 555-6789 ext. 2";
    expect(maskContactInfo(text)).toBe(`Hi!\nMy cell: ${M}\nWork: ${M} ext. 2`);
  });

  it("masks back-to-back parenthesised numbers separately", () => {
    expect(maskContactInfo("(416 555 1234)(647 555 0000)")).toBe(`${M}${M}`);
    expect(maskContactInfo("416-555-1234(647)555-0000")).toBe(`${M}${M}`);
  });

  it("does not swallow an unrelated number before the phone", () => {
    expect(maskContactInfo("Unit 5 416-555-1234")).toBe(`Unit 5 ${M}`);
    expect(maskContactInfo("at 12:30 4165551234")).toBe(`at 12:30 ${M}`);
  });

  it("masks a phone number followed by more digits", () => {
    expect(maskContactInfo("416 555 1234 2 times")).toBe(`${M} 2 times`);
  });

  it("keeps a $ price but still masks a phone number written right after it", () => {
    expect(maskContactInfo("It's $120. 416-555-1234 is my cell")).toBe(
      `It's $120. ${M} is my cell`,
    );
    expect(maskContactInfo("Price is $95 416 555 1234 call me")).toBe(`Price is $95 ${M} call me`);
    expect(maskContactInfo("$1 4165551234")).toBe(`$1 ${M}`);
    expect(maskContactInfo("Total $80/416-555-1234")).toBe(`Total $80/${M}`);
    expect(maskContactInfo("$75 - 647 555 0000")).toBe(`$75 - ${M}`);
    expect(maskContactInfo("$120.50 416-555-1234")).toBe(`$120.50 ${M}`);
  });

  it("does not treat a ten-digit number after $ as a price", () => {
    expect(maskContactInfo("$4165551234")).toBe(`$${M}`);
    expect(maskContactInfo("$ 416 555 1234")).toBe(`$ ${M}`);
  });

  it("still masks a phone number whose parts happen to be round ascending amounts", () => {
    expect(maskContactInfo("(450) 600-1200")).toBe(M);
    expect(maskContactInfo("+1 450 600 1200")).toBe(M);
    expect(maskContactInfo("1-450-600-1200")).toBe(M);
  });

  it.each([
    "123-456-7890", // area codes never start with 0 or 1
    "416-055-1234", // nor do exchanges
    "555-1234", // 7-digit local numbers are not masked (ambiguous with ranges)
    "416555123456", // a 12-digit reference number is not a phone number
    "41 65 55 12 34", // pairs straddle the area-code boundary
  ])("leaves invalid or local-only number %s", (text) => {
    expect(maskContactInfo(text)).toBe(text);
  });
});

describe("emails", () => {
  it.each([
    "jane.doe@example.com",
    "JANE@EXAMPLE.CA",
    "jane+tag@sub.example.co.uk",
    "j_doe-99@my-domain.io",
    "jane @ example.com",
    "jane@example . com",
    "jane(at)example(dot)com",
    "jane (at) example (dot) com",
    "jane [at] example [dot] ca",
    "jane{at}example{dot}org",
    "jane <at> example <dot> net",
    "jane at example dot com",
    "Jane AT Example DOT Com",
    "jane at example.com",
    "jane＠example.com",
    "jane[@]gmail.com",
    "jane (@) gmail.com",
    "jane {＠} gmail.com",
    "jane at example . com",
    "jane dot doe at gmail dot com",
    "jane (dot) doe (at) gmail (dot) com",
    "jane.doe at gmail dot com",
  ])("masks %s", (email) => {
    expect(maskContactInfo(email)).toBe(M);
  });

  it("masks inside sentences", () => {
    expect(maskContactInfo("Email me at jane@example.com, thanks!")).toBe(
      `Email me at ${M}, thanks!`,
    );
    expect(maskContactInfo("reach me: bob (at) gmail (dot) com or 416 555 1234")).toBe(
      `reach me: ${M} or ${M}`,
    );
  });

  it("masks an email containing a phone number once", () => {
    expect(maskContactInfo("4165551234@gmail.com")).toBe(M);
  });
});

describe("leaves ordinary text alone", () => {
  it.each([
    "That will be $180 for the visit.",
    "Total $1,234.56 including tax",
    "Quote: $1200 for the season",
    "$450 / 600 / 1200 for small, medium and large",
    "Small/medium/large: 450 / 600 / 1200",
    "Tiers 350-450-1100",
    "Season price 450.600.1200",
    "We can come at 9:00",
    "Between 9:00-10:30 works",
    "10:30am or 2pm",
    "Booked for 2026-10-21",
    "Booked for 2026-10-21 10:30",
    "2026-10-21 10am please",
    "21/10/2026 at 9",
    "10/21/2026 10",
    "Oct 21, 2026",
    "My postal code is M5V 3L9",
    "K1A 0B1",
    "2 visits per week, 3 bags of leaves",
    "Driveway is 200-1500 sq ft",
    "Unit 1204, 55 Main St",
    "Order 12345 and 67890",
    "Card ending 4242 4242 4242 4242",
    "We got 15 cm of snow, +5 cm tonight",
    "@john great job",
    "See you @ 5pm. Bring gloves",
    "We'll be at site. Co-op parking is fine",
    "Meet at 10.30 near the gate",
    "Rated 5/5!",
    "Arriving at noon. Email me if anything changes",
    "We finished at 3. Me and Sam will be back Tuesday",
    "Crew arrives at 8. Info about parking below",
    "Paid at checkout. Online receipt is in the app",
    "See you @ 5pm. Me and Sam will bring the mower",
    "",
  ])("%s", (text) => {
    expect(maskContactInfo(text)).toBe(text);
    expect(containsContactInfo(text)).toBe(false);
  });
});

describe("containsContactInfo", () => {
  it("detects phones and emails", () => {
    expect(containsContactInfo("call 416 555 1234")).toBe(true);
    expect(containsContactInfo("jane@example.com")).toBe(true);
    expect(containsContactInfo("see you at 9")).toBe(false);
  });

  it("is idempotent once masked", () => {
    const masked = maskContactInfo("call 416 555 1234 or jane@example.com");
    expect(maskContactInfo(masked)).toBe(masked);
    expect(containsContactInfo(masked)).toBe(false);
  });
});
