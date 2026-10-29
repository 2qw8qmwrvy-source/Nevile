import { describe, expect, it } from "vitest";
import {
  BEST_MATCH_WEIGHTS,
  bestMatchScore,
  priceSummary,
  type RankInput,
  rankResults,
  serviceAreaDescription,
  weightedRating,
} from "./search.ts";
import { searchInputSchema } from "./search-input.ts";

const base: RankInput = {
  id: "a",
  name: "Alpha Lawns",
  distanceKm: 5,
  radiusKm: 25,
  rating: null,
  isPro: false,
};

describe("weightedRating", () => {
  it("is null without reviews and pulls small samples towards the prior", () => {
    expect(weightedRating(null)).toBeNull();
    expect(weightedRating({ average: 5, count: 0 })).toBeNull();
    const one = weightedRating({ average: 5, count: 1 }) ?? 0;
    const many = weightedRating({ average: 4.8, count: 40 }) ?? 0;
    expect(one).toBeLessThan(many);
    expect(many).toBeGreaterThan(4.7);
  });
});

describe("bestMatchScore", () => {
  it("prefers closer businesses, all else equal", () => {
    expect(bestMatchScore({ ...base, distanceKm: 2 })).toBeGreaterThan(
      bestMatchScore({ ...base, distanceKm: 20 }),
    );
  });

  it("adds exactly the disclosed Pro boost", () => {
    expect(bestMatchScore({ ...base, isPro: true }) - bestMatchScore(base)).toBeCloseTo(
      BEST_MATCH_WEIGHTS.proBoost,
      12,
    );
  });

  it("doesn't punish new businesses below a poorly rated one", () => {
    const poor = bestMatchScore({ ...base, rating: { average: 2.5, count: 30 } });
    expect(bestMatchScore(base)).toBeGreaterThan(poor);
  });

  it("handles an unknown customer area", () => {
    expect(bestMatchScore({ ...base, distanceKm: null })).toBeGreaterThan(0);
  });
});

describe("rankResults", () => {
  const items: RankInput[] = [
    { ...base, id: "near", name: "Near Co", distanceKm: 1 },
    { ...base, id: "far-pro", name: "Far Pro", distanceKm: 20, isPro: true },
    { ...base, id: "rated", name: "Rated Co", distanceKm: 8, rating: { average: 4.9, count: 60 } },
    { ...base, id: "unknown", name: "Unknown Co", distanceKm: null },
  ];

  it("sorts closest first with unknown distances last", () => {
    expect(rankResults(items, "closest").map((item) => item.id)).toEqual([
      "near",
      "rated",
      "far-pro",
      "unknown",
    ]);
  });

  it("sorts top rated first with unrated businesses after", () => {
    expect(rankResults(items, "top_rated")[0]?.id).toBe("rated");
  });

  it("uses the best-match score by default and never mutates the input", () => {
    const before = items.map((item) => item.id);
    const ranked = rankResults(items, "best");
    expect(items.map((item) => item.id)).toEqual(before);
    const scores = ranked.map(bestMatchScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("breaks ties by name so the order is stable", () => {
    const twins: RankInput[] = [
      { ...base, id: "2", name: "Bravo" },
      { ...base, id: "1", name: "Alpha" },
    ];
    expect(rankResults(twins, "best").map((item) => item.name)).toEqual(["Alpha", "Bravo"]);
  });
});

describe("listing copy", () => {
  it("summarises prices", () => {
    expect(priceSummary({ pricingType: "fixed", priceCents: 6000 })).toBe("$60 / visit");
    expect(priceSummary({ pricingType: "fixed", priceCents: 6550 })).toBe("$65.50 / visit");
    expect(priceSummary({ pricingType: "quote", fromPriceCents: 4500 })).toBe("Quote · from $45");
    expect(priceSummary({ pricingType: "quote", fromPriceCents: null })).toBe("Quote");
  });

  it("describes a service area without an address", () => {
    expect(serviceAreaDescription(25, "Bedford")).toBe("Serves about 25 km around Bedford");
    expect(serviceAreaDescription(10, null)).toBe("Serves about 10 km");
  });
});

describe("searchInputSchema", () => {
  it("applies defaults and parses query-string flags", () => {
    expect(searchInputSchema.parse({})).toMatchObject({
      sort: "best",
      page: 1,
      instantBook: false,
      verified: false,
    });
    expect(searchInputSchema.parse({ instantBook: "true", pro: "1", verified: "0" })).toMatchObject(
      {
        instantBook: true,
        pro: true,
        verified: false,
      },
    );
  });

  it("rejects unknown categories, sorts and huge pages", () => {
    expect(searchInputSchema.safeParse({ category: "plumbing" }).success).toBe(false);
    expect(searchInputSchema.safeParse({ sort: "cheapest" }).success).toBe(false);
    expect(searchInputSchema.safeParse({ page: 500 }).success).toBe(false);
  });
});
