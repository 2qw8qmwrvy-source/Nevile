import { describe, expect, it } from "vitest";
import {
  canRate,
  canReply,
  RATING_WINDOW_DAYS,
  ratingDeadline,
  ratingInputSchema,
  ratingMonthKey,
  ratingReplyInputSchema,
  starsSchema,
} from "./ratings.ts";

const DAY = 86_400_000;
const COMPLETED = new Date("2026-10-01T15:00:00Z");
const after = (ms: number) => new Date(COMPLETED.getTime() + ms);
const base = {
  jobCompletedAt: COMPLETED,
  existingRatingsByRaterInMonth: 0,
  isRecurring: false,
};

describe("canRate", () => {
  it("allows rating right after completion", () => {
    expect(canRate({ ...base, now: COMPLETED })).toEqual({
      ok: true,
      deadline: after(14 * DAY),
    });
  });

  it("requires a completed job", () => {
    expect(canRate({ ...base, jobCompletedAt: null, now: COMPLETED })).toEqual({
      ok: false,
      reason: "not_completed",
    });
    expect(canRate({ ...base, jobCompletedAt: undefined, now: COMPLETED }).ok).toBe(false);
    expect(canRate({ ...base, now: new Date(COMPLETED.getTime() - 1) })).toEqual({
      ok: false,
      reason: "not_completed",
    });
  });

  it("closes the window after 14 days (the exact 14-day mark is still allowed)", () => {
    expect(RATING_WINDOW_DAYS).toBe(14);
    expect(canRate({ ...base, now: after(14 * DAY) }).ok).toBe(true);
    expect(canRate({ ...base, now: after(14 * DAY + 1) })).toEqual({
      ok: false,
      reason: "window_closed",
    });
  });

  it("allows one rating per one-off job", () => {
    expect(canRate({ ...base, now: after(DAY), existingRatingsByRaterInMonth: 1 })).toEqual({
      ok: false,
      reason: "already_rated",
    });
  });

  it("allows one rating per month for recurring jobs and contracts", () => {
    const recurring = { ...base, isRecurring: true, now: after(DAY) };
    expect(canRate({ ...recurring, existingRatingsByRaterInMonth: 0 }).ok).toBe(true);
    expect(canRate({ ...recurring, existingRatingsByRaterInMonth: 1 })).toEqual({
      ok: false,
      reason: "monthly_limit_reached",
    });
    expect(canRate({ ...recurring, existingRatingsByRaterInMonth: 3 }).ok).toBe(false);
  });

  it("checks the window before the count", () => {
    expect(
      canRate({ ...base, now: after(20 * DAY), existingRatingsByRaterInMonth: 1 }),
    ).toMatchObject({ reason: "window_closed" });
  });

  it("rejects invalid input", () => {
    expect(() => canRate({ ...base, now: new Date("x") })).toThrow(RangeError);
    expect(() => canRate({ ...base, now: COMPLETED, existingRatingsByRaterInMonth: -1 })).toThrow(
      RangeError,
    );
    expect(() => canRate({ ...base, now: COMPLETED, existingRatingsByRaterInMonth: 0.5 })).toThrow(
      RangeError,
    );
    expect(() => ratingDeadline(new Date("x"))).toThrow(RangeError);
  });
});

describe("ratingMonthKey", () => {
  it("uses the local month of the visit", () => {
    // 2026-11-01T02:30Z is still 23:30 ADT on Oct 31 in Halifax (the default zone).
    const at = new Date("2026-11-01T02:30:00Z");
    expect(ratingMonthKey(at)).toBe("2026-10");
    expect(ratingMonthKey(at, "America/Halifax")).toBe("2026-10");
    expect(ratingMonthKey(at, "UTC")).toBe("2026-11");
    // 03:30Z is already November in Halifax but still October in Toronto.
    const later = new Date("2026-11-01T03:30:00Z");
    expect(ratingMonthKey(later)).toBe("2026-11");
    expect(ratingMonthKey(later, "America/Toronto")).toBe("2026-10");
    expect(ratingMonthKey(new Date("2027-01-15T12:00:00Z"))).toBe("2027-01");
  });
});

describe("canReply", () => {
  it("allows exactly one reply", () => {
    expect(canReply({ existingReplies: 0 })).toBe(true);
    expect(canReply({ existingReplies: 1 })).toBe(false);
  });
});

describe("ratingInputSchema", () => {
  it.each([1, 2, 3, 4, 5])("accepts %s stars", (stars) => {
    expect(ratingInputSchema.parse({ stars })).toEqual({ stars });
  });

  it.each([0, 6, 3.5, -1, Number.NaN, "5", null])("rejects stars %s", (stars) => {
    expect(ratingInputSchema.safeParse({ stars }).success).toBe(false);
    expect(starsSchema.safeParse(stars).success).toBe(false);
  });

  it("trims the comment and drops it when empty", () => {
    expect(ratingInputSchema.parse({ stars: 5, comment: "  Great job!  " })).toEqual({
      stars: 5,
      comment: "Great job!",
    });
    expect(ratingInputSchema.parse({ stars: 4, comment: "   " })).toEqual({ stars: 4 });
    expect(ratingInputSchema.parse({ stars: 4, comment: "" })).toEqual({ stars: 4 });
  });

  it("limits the comment to 1000 characters", () => {
    expect(ratingInputSchema.safeParse({ stars: 3, comment: "a".repeat(1000) }).success).toBe(true);
    expect(ratingInputSchema.safeParse({ stars: 3, comment: "a".repeat(1001) }).success).toBe(
      false,
    );
    // Trimming happens before the length check.
    expect(
      ratingInputSchema.safeParse({ stars: 3, comment: ` ${"a".repeat(1000)} ` }).success,
    ).toBe(true);
  });

  it("rejects a non-string comment", () => {
    expect(ratingInputSchema.safeParse({ stars: 3, comment: 42 }).success).toBe(false);
  });
});

describe("ratingReplyInputSchema", () => {
  it("accepts and trims a reply", () => {
    expect(ratingReplyInputSchema.parse({ body: "  Thanks!  " })).toEqual({ body: "Thanks!" });
  });

  it("rejects empty or whitespace-only replies", () => {
    expect(ratingReplyInputSchema.safeParse({ body: "" }).success).toBe(false);
    expect(ratingReplyInputSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(ratingReplyInputSchema.safeParse({}).success).toBe(false);
  });

  it("limits replies to 1000 characters", () => {
    expect(ratingReplyInputSchema.safeParse({ body: "b".repeat(1000) }).success).toBe(true);
    expect(ratingReplyInputSchema.safeParse({ body: "b".repeat(1001) }).success).toBe(false);
  });
});
