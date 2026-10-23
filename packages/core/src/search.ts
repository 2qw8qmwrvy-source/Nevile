/**
 * Search ordering and listing copy (SPEC §18). Pure functions: the API gathers candidates
 * (businesses whose radius covers the customer) and these decide the order and the text.
 */
import { z } from "zod";
import { CATEGORY_SLUGS } from "./categories.ts";
import { formatCad } from "./money.ts";

export const SEARCH_SORTS = ["best", "closest", "top_rated"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export const SEARCH_SORT_LABELS: Record<SearchSort, string> = {
  best: "Best match",
  closest: "Closest",
  top_rated: "Top rated",
};

/** "Rating 4.5+" filter (SPEC §18). */
export const MIN_RATING_FILTER = 4.5;
export const SEARCH_PAGE_SIZE = 20;

/**
 * Bayesian ("confidence-weighted") rating: the average pulled towards a prior by a few
 * imaginary reviews, so 1 five-star review doesn't beat 40 reviews averaging 4.8.
 */
export const RATING_PRIOR = { mean: 4.3, weight: 5 } as const;

export type RatingSummary = { average: number; count: number };

export function weightedRating(rating: RatingSummary | null): number | null {
  if (!rating || rating.count <= 0) return null;
  const { mean, weight } = RATING_PRIOR;
  return (rating.average * rating.count + mean * weight) / (rating.count + weight);
}

/**
 * Weights of the "Best match" score. Proximity and rating are each scaled to 0–1; the Pro
 * boost is added on top and is always disclosed with the Pro badge (SPEC §8, §18).
 */
export const BEST_MATCH_WEIGHTS = { proximity: 0.5, rating: 0.35, proBoost: 0.15 } as const;
/** Rating score used for businesses with no reviews yet: neutral, not punished. */
export const NEW_BUSINESS_RATING_SCORE = 0.6;

export type RankInput = {
  id: string;
  name: string;
  /** Km from the customer, or null when the customer's area is unknown. */
  distanceKm: number | null;
  radiusKm: number;
  rating: RatingSummary | null;
  isPro: boolean;
};

export function bestMatchScore(item: RankInput): number {
  const proximity =
    item.distanceKm === null ? 0.5 : 1 - Math.min(item.distanceKm / Math.max(item.radiusKm, 1), 1);
  const weighted = weightedRating(item.rating);
  const ratingScore = weighted === null ? NEW_BUSINESS_RATING_SCORE : (weighted - 1) / 4;
  return (
    BEST_MATCH_WEIGHTS.proximity * proximity +
    BEST_MATCH_WEIGHTS.rating * ratingScore +
    (item.isPro ? BEST_MATCH_WEIGHTS.proBoost : 0)
  );
}

const byName = (a: RankInput, b: RankInput) =>
  a.name.localeCompare(b.name, "en-CA") || a.id.localeCompare(b.id);
const byDistance = (a: RankInput, b: RankInput) => {
  if (a.distanceKm === null && b.distanceKm === null) return 0;
  if (a.distanceKm === null) return 1;
  if (b.distanceKm === null) return -1;
  return a.distanceKm - b.distanceKm;
};

/** Orders search results; ties fall back to distance, then name, so order is stable. */
export function rankResults<T extends RankInput>(items: readonly T[], sort: SearchSort): T[] {
  const sorted = [...items];
  switch (sort) {
    case "best": {
      const scores = new Map(items.map((item) => [item.id, bestMatchScore(item)]));
      sorted.sort(
        (a, b) =>
          (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || byDistance(a, b) || byName(a, b),
      );
      break;
    }
    case "closest":
      sorted.sort((a, b) => byDistance(a, b) || byName(a, b));
      break;
    case "top_rated":
      sorted.sort((a, b) => {
        const ra = weightedRating(a.rating);
        const rb = weightedRating(b.rating);
        if (ra !== rb) {
          if (ra === null) return 1;
          if (rb === null) return -1;
          return rb - ra;
        }
        return (b.rating?.count ?? 0) - (a.rating?.count ?? 0) || byDistance(a, b) || byName(a, b);
      });
      break;
  }
  return sorted;
}

export type PriceInfo =
  | { pricingType: "fixed"; priceCents: number }
  | { pricingType: "quote"; fromPriceCents: number | null };

const wholeDollars = (cents: number) => formatCad(cents).replace(/\.00$/, "");

/** "$60 / visit", "Quote · from $45" or "Quote" (SPEC §18). */
export function priceSummary(price: PriceInfo): string {
  if (price.pricingType === "fixed") return `${wholeDollars(price.priceCents)} / visit`;
  return price.fromPriceCents === null
    ? "Quote"
    : `Quote · from ${wholeDollars(price.fromPriceCents)}`;
}

/** "Serves about 25 km around Bedford" (never the exact base address). */
export function serviceAreaDescription(radiusKm: number, placeName: string | null): string {
  const around = placeName ? ` around ${placeName}` : "";
  return `Serves about ${radiusKm} km${around}`;
}

const optionalFlag = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .optional()
  .transform((value) => value === true || value === "true" || value === "1");

/** Search input from the website or app; everything is optional except where noted. */
export const searchInputSchema = z.object({
  category: z.enum(CATEGORY_SLUGS).optional(),
  /** Full postal code or just the area ("B3H"). */
  postalCode: z.string().trim().max(10).optional(),
  /** "Use my location": a precise point instead of the postal area. Never stored. */
  near: z
    .object({
      lat: z.number().finite().min(-90).max(90),
      lng: z.number().finite().min(-180).max(180),
    })
    .optional(),
  sort: z.enum(SEARCH_SORTS).default("best"),
  instantBook: optionalFlag,
  verified: optionalFlag,
  pro: optionalFlag,
  topRated: optionalFlag,
  page: z.number().int().min(1).max(50).default(1),
});
export type SearchInput = z.input<typeof searchInputSchema>;
export type SearchQuery = z.output<typeof searchInputSchema>;
