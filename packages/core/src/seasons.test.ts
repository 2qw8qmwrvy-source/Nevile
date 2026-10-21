import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "./categories.ts";
import { SEASONAL_CATEGORY_SLUGS, SEASONS, type Season, seasonFor } from "./seasons.ts";
import { fromLocal } from "./time.ts";

const TORONTO = "America/Toronto";

describe("seasonFor", () => {
  it.each<[number, Season]>([
    [1, "winter"],
    [2, "winter"],
    [3, "spring"],
    [4, "spring"],
    [5, "spring"],
    [6, "summer"],
    [7, "summer"],
    [8, "summer"],
    [9, "fall"],
    [10, "fall"],
    [11, "fall"],
    [12, "winter"],
  ])("month %s is %s", (month, season) => {
    expect(seasonFor(fromLocal({ year: 2026, month, day: 15, hour: 12 }, TORONTO))).toBe(season);
  });

  it.each<[string, Season]>([
    ["2026-12-01T04:59:59.999Z", "fall"], // Nov 30 23:59:59.999 EST
    ["2026-12-01T05:00:00.000Z", "winter"], // Dec 1 00:00 EST
    ["2026-03-01T04:59:59.999Z", "winter"], // Feb 28 23:59:59.999 EST
    ["2026-03-01T05:00:00.000Z", "spring"],
    ["2026-06-01T03:59:59.999Z", "spring"], // May 31 23:59:59.999 EDT
    ["2026-06-01T04:00:00.000Z", "summer"],
    ["2026-09-01T03:59:59.999Z", "summer"],
    ["2026-09-01T04:00:00.000Z", "fall"],
  ])("Toronto boundary %s is %s", (instant, season) => {
    expect(seasonFor(new Date(instant), TORONTO)).toBe(season);
  });

  it("uses the given zone", () => {
    // 2026-12-01T06:00Z is still Nov 30 (22:00) in Vancouver, but Dec 1 in Toronto.
    const at = new Date("2026-12-01T06:00:00Z");
    expect(seasonFor(at, TORONTO)).toBe("winter");
    expect(seasonFor(at, "America/Vancouver")).toBe("fall");
  });

  it("rejects invalid input", () => {
    expect(() => seasonFor(new Date("x"))).toThrow(RangeError);
    expect(() => seasonFor(new Date(), "Bad/Zone")).toThrow(RangeError);
  });
});

describe("SEASONAL_CATEGORY_SLUGS", () => {
  it("matches the agreed ordering", () => {
    expect(SEASONAL_CATEGORY_SLUGS).toEqual({
      winter: ["snow-ice-removal", "house-cleaning", "window-washing"],
      spring: ["yard-cleanup", "lawn-mowing", "pressure-washing", "window-washing"],
      summer: ["lawn-mowing", "pressure-washing", "window-washing", "gutter-cleaning"],
      fall: ["leaf-cleanup", "gutter-cleaning", "yard-cleanup", "lawn-mowing"],
    });
  });

  it("only references known categories, without duplicates", () => {
    const known = new Set(DEFAULT_CATEGORIES.map((category) => category.slug));
    for (const season of SEASONS) {
      const slugs = SEASONAL_CATEGORY_SLUGS[season];
      expect(new Set(slugs).size).toBe(slugs.length);
      for (const slug of slugs) expect(known.has(slug)).toBe(true);
    }
  });
});
