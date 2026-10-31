import type { CategorySlug, LatLng, SearchSort } from "@nevile/core";
import type { Route } from "next";

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
