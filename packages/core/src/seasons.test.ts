import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "./categories.ts";
import {
  nextSeason,
  SEASON_MONTHS,
  SEASON_NUDGE_KEYS,
  SEASONAL_CATEGORY_SLUGS,
  SEASONS,
  type Season,
  seasonFor,
  seasonNudgeFor,
  seasonOfMonth,
} from "./seasons.ts";
import { fromLocal } from "./time.ts";

const HALIFAX = "America/Halifax";
const midMonth = (month: number, zone = HALIFAX) =>
  fromLocal({ year: 2026, month, day: 15, hour: 12 }, zone);

describe("SEASON_MONTHS (SPEC §13, Nova Scotia's climate)", () => {
  it("matches the agreed table", () => {
    expect(SEASON_MONTHS).toEqual({
      winter: [12, 1, 2, 3],
      spring: [4, 5],
      summer: [6, 7, 8],
      fall: [9, 10, 11],
    });
  });

  it("covers each month exactly once", () => {
    const months = SEASONS.flatMap((season) => SEASON_MONTHS[season]);
    expect([...months].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe("seasonFor / seasonOfMonth", () => {
  it.each<[number, Season]>([
    [1, "winter"],
    [2, "winter"],
    [3, "winter"],
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
    expect(seasonOfMonth(month)).toBe(season);
    expect(seasonFor(midMonth(month))).toBe(season);
  });

  it.each<[string, Season]>([
    ["2026-04-01T02:59:59.999Z", "winter"], // Mar 31 23:59:59.999 ADT
    ["2026-04-01T03:00:00.000Z", "spring"], // Apr 1 00:00 ADT
    ["2026-06-01T02:59:59.999Z", "spring"],
    ["2026-06-01T03:00:00.000Z", "summer"],
    ["2026-09-01T02:59:59.999Z", "summer"],
    ["2026-09-01T03:00:00.000Z", "fall"],
    ["2026-12-01T03:59:59.999Z", "fall"], // Nov 30 23:59:59.999 AST
    ["2026-12-01T04:00:00.000Z", "winter"], // Dec 1 00:00 AST
    ["2027-01-01T03:59:59.999Z", "winter"], // year end stays winter
  ])("Halifax boundary %s is %s (default zone)", (instant, season) => {
    expect(seasonFor(new Date(instant))).toBe(season);
    expect(seasonFor(new Date(instant), HALIFAX)).toBe(season);
  });

  it("defaults to Halifax and honours another zone", () => {
    // 04:30 UTC on Dec 1 is 00:30 in Halifax but still 23:30 on Nov 30 in Toronto.
    const at = new Date("2026-12-01T04:30:00Z");
    expect(seasonFor(at)).toBe("winter");
    expect(seasonFor(at, "America/Toronto")).toBe("fall");
    expect(seasonFor(at, "America/Vancouver")).toBe("fall");
  });

  it("does not depend on the host zone or the UTC month", () => {
    // 01:00 UTC on Apr 1 is still March 31 (22:00 ADT) in Halifax.
    expect(seasonFor(new Date("2026-04-01T01:00:00Z"))).toBe("winter");
  });

  it("rejects invalid input", () => {
    expect(() => seasonFor(new Date("x"))).toThrow(RangeError);
    expect(() => seasonFor(new Date(), "Bad/Zone")).toThrow(RangeError);
    for (const month of [0, 13, 1.5, Number.NaN]) {
      expect(() => seasonOfMonth(month)).toThrow(RangeError);
    }
  });
});

describe("nextSeason", () => {
  it("cycles winter → spring → summer → fall → winter", () => {
    expect(SEASONS.map(nextSeason)).toEqual(["spring", "summer", "fall", "winter"]);
  });

  it("rejects an unknown season", () => {
    expect(() => nextSeason("monsoon" as Season)).toThrow(RangeError);
  });
});

describe("seasonNudgeFor", () => {
  it.each([1, 2, 4, 6, 7, 9, 10, 12])("is null mid-season (month %s)", (month) => {
    expect(seasonNudgeFor(midMonth(month))).toBeNull();
  });

  it("November: lock in a snow contract before the first storm", () => {
    expect(seasonNudgeFor(midMonth(11))).toEqual({
      nextSeason: "winter",
      categorySlug: "snow-ice-removal",
      key: "snow-contract",
      headline: "Snow's coming — lock in a seasonal snow contract before the first storm",
    });
  });

  it.each<[number, Season, string, string]>([
    [3, "spring", "yard-cleanup", "spring-yard-cleanup"],
    [5, "summer", "lawn-mowing", "lawn-mowing-season"],
    [8, "fall", "gutter-cleaning", "fall-gutter-cleanup"],
    [11, "winter", "snow-ice-removal", "snow-contract"],
  ])("month %s nudges toward %s with %s", (month, season, categorySlug, key) => {
    const nudge = seasonNudgeFor(midMonth(month));
    expect(nudge).toMatchObject({ nextSeason: season, categorySlug, key });
    expect(nudge?.headline.length).toBeGreaterThan(0);
  });

  it("appears only in the last month of each season, announcing the next one", () => {
    for (let month = 1; month <= 12; month++) {
      const nudge = seasonNudgeFor(midMonth(month));
      const season = seasonOfMonth(month);
      const isLastMonth = SEASON_MONTHS[season].at(-1) === month;
      expect(nudge !== null).toBe(isLastMonth);
      if (nudge) {
        expect(nudge.nextSeason).toBe(nextSeason(season));
        expect(nudge.nextSeason).toBe(seasonOfMonth((month % 12) + 1));
        expect(SEASONAL_CATEGORY_SLUGS[nudge.nextSeason]).toContain(nudge.categorySlug);
      }
    }
  });

  it("uses one key per nudge", () => {
    const keys = [3, 5, 8, 11].map((month) => seasonNudgeFor(midMonth(month))?.key);
    expect(keys.sort()).toEqual([...SEASON_NUDGE_KEYS].sort());
  });

  it("switches at local midnight in Halifax", () => {
    expect(seasonNudgeFor(new Date("2026-11-01T02:59:59.999Z"))).toBeNull(); // Oct 31 ADT
    expect(seasonNudgeFor(new Date("2026-11-01T03:00:00.000Z"))?.key).toBe("snow-contract");
    expect(seasonNudgeFor(new Date("2026-12-01T03:59:59.999Z"))?.key).toBe("snow-contract");
    expect(seasonNudgeFor(new Date("2026-12-01T04:00:00.000Z"))).toBeNull(); // Dec 1 AST
    expect(seasonNudgeFor(new Date("2026-03-01T03:59:59.999Z"))).toBeNull(); // Feb 28 AST
    expect(seasonNudgeFor(new Date("2026-03-01T04:00:00.000Z"))?.key).toBe("spring-yard-cleanup");
  });

  it("honours another zone", () => {
    // Still Oct 31 (23:30) in Toronto, already Nov 1 (00:30) in Halifax.
    const at = new Date("2026-11-01T03:30:00Z");
    expect(seasonNudgeFor(at)?.key).toBe("snow-contract");
    expect(seasonNudgeFor(at, "America/Toronto")).toBeNull();
  });

  it("returns a fresh object each time", () => {
    const a = seasonNudgeFor(midMonth(11));
    const b = seasonNudgeFor(midMonth(11));
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("rejects invalid input", () => {
    expect(() => seasonNudgeFor(new Date("x"))).toThrow(RangeError);
    expect(() => seasonNudgeFor(new Date(), "Bad/Zone")).toThrow(RangeError);
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
