import { describe, expect, it } from "vitest";
import {
  medianResponseMinutes,
  messageInputSchema,
  QUOTE_REQUEST_LIMITS,
  quoteDeclineSchema,
  quoteExpiresAt,
  quoteReplyDeadline,
  quoteReplySchema,
  quoteRequestInputSchema,
  quoteTimingLabel,
  responseTimeLabel,
  sameQuoteArea,
  unreadEmailDue,
} from "./quotes.ts";

const ids = [
  "0b9d6a3e-5f43-4c1e-9a55-0f0e8b7d1a01",
  "0b9d6a3e-5f43-4c1e-9a55-0f0e8b7d1a02",
  "0b9d6a3e-5f43-4c1e-9a55-0f0e8b7d1a03",
  "0b9d6a3e-5f43-4c1e-9a55-0f0e8b7d1a04",
];

const request = {
  categorySlug: "lawn-mowing",
  businessIds: [ids[0]],
  details: "Front and back lawn, about 400 square metres, gate on the left side.",
  postalCode: "B3H 1A1",
  timing: "within_week",
};

describe("quote requests (SPEC §20)", () => {
  it("accepts a request to up to 3 pros, with photos optional", () => {
    const parsed = quoteRequestInputSchema.parse({ ...request, businessIds: ids.slice(0, 3) });
    expect(parsed.businessIds).toHaveLength(3);
    expect(parsed.photoIds).toEqual([]);
    expect(parsed.postalCode).toBe("B3H 1A1");
  });

  it("refuses more than 3 pros, duplicates, or none", () => {
    expect(quoteRequestInputSchema.safeParse({ ...request, businessIds: ids }).success).toBe(false);
    expect(
      quoteRequestInputSchema.safeParse({ ...request, businessIds: [ids[0], ids[0]] }).success,
    ).toBe(false);
    expect(quoteRequestInputSchema.safeParse({ ...request, businessIds: [] }).success).toBe(false);
  });

  it("needs a real description, a Nova Scotia postal code and a timing", () => {
    expect(quoteRequestInputSchema.safeParse({ ...request, details: "Mow it" }).success).toBe(
      false,
    );
    expect(
      quoteRequestInputSchema.safeParse({ ...request, details: "x".repeat(2001) }).success,
    ).toBe(false);
    expect(
      quoteRequestInputSchema.safeParse({
        ...request,
        details: `Lawn please\u0007 ${"a".repeat(20)}`,
      }).success,
    ).toBe(false);
    expect(quoteRequestInputSchema.safeParse({ ...request, postalCode: "M5V 2T6" }).success).toBe(
      false,
    );
    expect(quoteRequestInputSchema.safeParse({ ...request, timing: "someday" }).success).toBe(
      false,
    );
  });

  it("allows up to 6 photos", () => {
    const photos = Array.from(
      { length: 7 },
      (_, index) => `0b9d6a3e-5f43-4c1e-9a55-0f0e8b7d1b0${index}`,
    );
    expect(
      quoteRequestInputSchema.safeParse({ ...request, photoIds: photos.slice(0, 6) }).success,
    ).toBe(true);
    expect(quoteRequestInputSchema.safeParse({ ...request, photoIds: photos }).success).toBe(false);
  });

  it("labels timings and closes unanswered requests after 3 days", () => {
    expect(quoteTimingLabel("asap")).toBe("As soon as possible");
    const asked = new Date("2026-10-23T12:00:00Z");
    expect(quoteReplyDeadline(asked).toISOString()).toBe("2026-10-26T12:00:00.000Z");
    expect(QUOTE_REQUEST_LIMITS.maxOpenRequests).toBe(5);
  });
});

describe("quotes", () => {
  it("is one price from $5 to $20,000 with a listed duration", () => {
    expect(quoteReplySchema.parse({ priceCents: 12_000, durationMinutes: 120, note: "" })).toEqual({
      priceCents: 12_000,
      durationMinutes: 120,
      note: "",
    });
    expect(
      quoteReplySchema.safeParse({ priceCents: 499, durationMinutes: 60, note: "" }).success,
    ).toBe(false);
    expect(
      quoteReplySchema.safeParse({ priceCents: 2_000_001, durationMinutes: 60, note: "" }).success,
    ).toBe(false);
    expect(
      quoteReplySchema.safeParse({ priceCents: 5000, durationMinutes: 50, note: "" }).success,
    ).toBe(false);
    expect(
      quoteReplySchema.safeParse({ priceCents: 50.5, durationMinutes: 60, note: "" }).success,
    ).toBe(false);
  });

  it("expires 7 days after it is sent", () => {
    expect(quoteExpiresAt(new Date("2026-10-23T12:00:00Z")).toISOString()).toBe(
      "2026-10-30T12:00:00.000Z",
    );
  });

  it("needs a reason to decline", () => {
    expect(quoteDeclineSchema.safeParse({ reason: "  " }).success).toBe(false);
    expect(quoteDeclineSchema.parse({ reason: " Too far for us " }).reason).toBe("Too far for us");
  });

  it("books only at an address in the same postal code area", () => {
    expect(sameQuoteArea("B3H 1A1", "b3h 4r2")).toBe(true);
    expect(sameQuoteArea("B3H 1A1", "B3K 5L2")).toBe(false);
    expect(sameQuoteArea("nope", "B3H 1A1")).toBe(false);
  });
});

describe("chat messages", () => {
  it("needs text or a photo", () => {
    expect(messageInputSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(messageInputSchema.parse({ body: " Hi there " }).body).toBe("Hi there");
    expect(messageInputSchema.safeParse({ body: "", photoIds: [ids[0]] }).success).toBe(true);
  });

  it("limits length and photos", () => {
    expect(messageInputSchema.safeParse({ body: "a".repeat(2001) }).success).toBe(false);
    expect(
      messageInputSchema.safeParse({
        body: "",
        photoIds: Array.from(
          { length: 7 },
          (_, index) => `0b9d6a3e-5f43-4c1e-9a55-0f0e8b7d1c0${index}`,
        ),
      }).success,
    ).toBe(false);
  });

  it("emails about unread messages once they are 10 minutes old", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    expect(unreadEmailDue({ oldestUnseenAt: null, now })).toBe(false);
    expect(unreadEmailDue({ oldestUnseenAt: new Date("2026-10-23T11:51:00Z"), now })).toBe(false);
    expect(unreadEmailDue({ oldestUnseenAt: new Date("2026-10-23T11:50:00Z"), now })).toBe(true);
  });
});

describe("response time", () => {
  it("needs 3 replies and uses the median", () => {
    expect(medianResponseMinutes([10, 20])).toBeNull();
    expect(medianResponseMinutes([300, 10, 20])).toBe(20);
    expect(medianResponseMinutes([10, 20, 30, 41])).toBe(25);
  });

  it("labels the median", () => {
    expect(responseTimeLabel(null)).toBeNull();
    expect(responseTimeLabel(45)).toBe("Usually replies within an hour");
    expect(responseTimeLabel(5 * 60)).toBe("Usually replies within a few hours");
    expect(responseTimeLabel(20 * 60)).toBe("Usually replies within a day");
    expect(responseTimeLabel(50 * 60)).toBe("Usually replies within 3 days");
  });
});
