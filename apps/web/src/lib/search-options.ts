import {
  CATEGORY_SLUGS,
  type CategorySlug,
  type LatLng,
  SEARCH_SORTS,
  type SearchSort,
} from "@nevile/core";
import type { Route } from "next";
import { z } from "zod";

/** The search filters (SPEC §18), as they appear in /search query strings. */
export const SEARCH_FILTERS = [
  { key: "instant", input: "instantBook", label: "Instant Book" },
  { key: "verified", input: "verified", label: "Verified" },
  { key: "pro", input: "pro", label: "Pro" },
  { key: "top", input: "topRated", label: "4.5+ stars" },
] as const;
export type SearchFilterKey = (typeof SEARCH_FILTERS)[number]["key"];

export type SearchParams = {
  service?: CategorySlug;
  postal?: string;
  /** "Use my location", already rounded to about 1 km by the browser. */
  near?: LatLng;
  sort: SearchSort;
  filters: Record<SearchFilterKey, boolean>;
  page: number;
};

/** First value of a possibly repeated query parameter. */
const single = z.preprocess(
  (value) => (Array.isArray(value) ? value[0] : value),
  z.string().optional(),
);
const flag = single.transform((value) => value === "1" || value === "true");

const paramsSchema = z.object({
  service: single.pipe(z.enum(CATEGORY_SLUGS).optional()).catch(undefined),
  postal: single
    .transform((value) => value?.trim().toUpperCase().replace(/\s+/g, " ") || undefined)
    .pipe(z.string().max(10).optional())
    .catch(undefined),
  near: single
    .transform((value) => {
      const match = value?.match(/^(-?\d{1,2}(?:\.\d{1,2})?),(-?\d{1,3}(?:\.\d{1,2})?)$/);
      return match ? { lat: Number(match[1]), lng: Number(match[2]) } : undefined;
    })
    .catch(undefined),
  sort: single.pipe(z.enum(SEARCH_SORTS).optional()).catch(undefined),
  instant: flag.catch(false),
  verified: flag.catch(false),
  pro: flag.catch(false),
  top: flag.catch(false),
  page: single
    .transform((value) => Number.parseInt(value ?? "1", 10))
    .pipe(z.number().int().min(1).max(50))
    .catch(1),
});

export function parseSearchParams(
  record: Record<string, string | string[] | undefined>,
): SearchParams {
  const parsed = paramsSchema.parse(record);
  return {
    service: parsed.service,
    postal: parsed.near ? undefined : parsed.postal,
    near: parsed.near,
    sort: parsed.sort ?? "best",
    filters: {
      instant: parsed.instant,
      verified: parsed.verified,
      pro: parsed.pro,
      top: parsed.top,
    },
    page: parsed.page,
  };
}

/** Rounds a browser location to 2 decimals (about 1 km) before it leaves the device. */
export function roundNear(point: LatLng): string {
  return `${point.lat.toFixed(2)},${point.lng.toFixed(2)}`;
}

/** /search URL for `params` with `changes` applied; changing anything but the page resets it. */
export function searchHref(params: SearchParams, changes: Partial<SearchParams> = {}): Route {
  const next = { ...params, ...changes };
  if (!("page" in changes)) next.page = 1;
  const query = new URLSearchParams();
  if (next.service) query.set("service", next.service);
  if (next.near) query.set("near", roundNear(next.near));
  else if (next.postal) query.set("postal", next.postal);
  if (next.sort !== "best") query.set("sort", next.sort);
  for (const filter of SEARCH_FILTERS) {
    if (next.filters[filter.key]) query.set(filter.key, "1");
  }
  if (next.page > 1) query.set("page", String(next.page));
  const text = query.toString();
  return (text ? `/search?${text}` : "/search") as Route;
}
