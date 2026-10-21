/**
 * Seasonal theming — SPEC §13: the hero and featured categories re-theme by season.
 * Winter: Dec–Feb, Spring: Mar–May, Summer: Jun–Aug, Fall: Sep–Nov (local months).
 */
import type { CategorySlug } from "./categories.ts";
import { DEFAULT_TIME_ZONE, toLocal } from "./time.ts";

export const SEASONS = ["winter", "spring", "summer", "fall"] as const;
export type Season = (typeof SEASONS)[number];

/** Season for each calendar month, January first. */
const SEASON_BY_MONTH: readonly Season[] = [
  "winter",
  "winter",
  "spring",
  "spring",
  "spring",
  "summer",
  "summer",
  "summer",
  "fall",
  "fall",
  "fall",
  "winter",
];

/** The season of an instant, using its local month in `timeZone`. */
export function seasonFor(date: Date, timeZone: string = DEFAULT_TIME_ZONE): Season {
  const { month } = toLocal(date, timeZone);
  const season = SEASON_BY_MONTH[month - 1];
  if (!season) throw new RangeError(`invalid month ${month}`);
  return season;
}

/** Featured categories per season, most relevant first. */
export const SEASONAL_CATEGORY_SLUGS: Readonly<Record<Season, readonly CategorySlug[]>> = {
  winter: ["snow-ice-removal", "house-cleaning", "window-washing"],
  spring: ["yard-cleanup", "lawn-mowing", "pressure-washing", "window-washing"],
  summer: ["lawn-mowing", "pressure-washing", "window-washing", "gutter-cleaning"],
  fall: ["leaf-cleanup", "gutter-cleaning", "yard-cleanup", "lawn-mowing"],
};
