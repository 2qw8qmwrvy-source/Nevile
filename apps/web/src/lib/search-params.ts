import { CATEGORY_SLUGS, SEARCH_SORTS } from "@nevile/core";
import { z } from "zod";
import type { SearchParams } from "./search-options.ts";

// Reading /search query strings happens on the server only, so the browser bundle for the
// search page doesn't carry the validation library (src/lib/search-options.ts is shared).

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
