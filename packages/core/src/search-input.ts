/** The search request schema (SPEC §18); ranking and labels are in `search.ts`. */
import { z } from "zod";
import { CATEGORY_SLUGS } from "./categories.ts";
import { SEARCH_SORTS } from "./search.ts";

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
