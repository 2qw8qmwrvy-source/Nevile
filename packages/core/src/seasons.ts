/**
 * Seasonal theming — SPEC §13. The hero and featured categories re-theme automatically by
 * the current month in Nova Scotia (no manual switcher). Seasons follow Nova Scotia's
 * climate rather than the astronomical calendar:
 *
 * | Season | Months               |
 * |--------|----------------------|
 * | Winter | December – March     |
 * | Spring | April – May          |
 * | Summer | June – August        |
 * | Fall   | September – November |
 *
 * In the last month of each season the hero adds a nudge for what's next (`seasonNudgeFor`).
 */
import type { CategorySlug } from "./categories.ts";
import { DEFAULT_TIME_ZONE, toLocal } from "./time.ts";

export const SEASONS = ["winter", "spring", "summer", "fall"] as const;
export type Season = (typeof SEASONS)[number];

/** Calendar months (1–12) of each season, in order. */
export const SEASON_MONTHS: Readonly<Record<Season, readonly number[]>> = {
  winter: [12, 1, 2, 3],
  spring: [4, 5],
  summer: [6, 7, 8],
  fall: [9, 10, 11],
};

/** Season for each calendar month, January first. */
const SEASON_BY_MONTH: readonly Season[] = Array.from({ length: 12 }, (_, index) => {
  const season = SEASONS.find((candidate) => SEASON_MONTHS[candidate].includes(index + 1));
  if (!season) throw new Error(`month ${index + 1} has no season`);
  return season;
});

function localMonth(date: Date, timeZone: string): number {
  return toLocal(date, timeZone).month;
}

/** The season of a calendar month (1–12). */
export function seasonOfMonth(month: number): Season {
  const season = Number.isInteger(month) ? SEASON_BY_MONTH[month - 1] : undefined;
  if (!season) throw new RangeError(`month must be an integer from 1 to 12, got ${month}`);
  return season;
}

/** The season of an instant, using its local month in `timeZone` (default Halifax). */
export function seasonFor(date: Date, timeZone: string = DEFAULT_TIME_ZONE): Season {
  return seasonOfMonth(localMonth(date, timeZone));
}

/** The season that follows `season` (fall → winter). */
export function nextSeason(season: Season): Season {
  const index = SEASONS.indexOf(season);
  if (index === -1) throw new RangeError(`unknown season "${String(season)}"`);
  return SEASONS[(index + 1) % SEASONS.length] as Season;
}

/** Featured categories per season, most relevant first. */
export const SEASONAL_CATEGORY_SLUGS: Readonly<Record<Season, readonly CategorySlug[]>> = {
  winter: ["snow-ice-removal", "house-cleaning", "window-washing"],
  spring: ["yard-cleanup", "lawn-mowing", "pressure-washing", "window-washing"],
  summer: ["lawn-mowing", "pressure-washing", "window-washing", "gutter-cleaning"],
  fall: ["leaf-cleanup", "gutter-cleaning", "yard-cleanup", "lawn-mowing"],
};

export const SEASON_NUDGE_KEYS = [
  "snow-contract",
  "spring-yard-cleanup",
  "lawn-mowing-season",
  "fall-gutter-cleanup",
] as const;
/** Stable identifier of a nudge, for copy lookup and analytics. */
export type SeasonNudgeKey = (typeof SEASON_NUDGE_KEYS)[number];

export type SeasonNudge = {
  /** The season about to start. */
  nextSeason: Season;
  /** Category the nudge links to. */
  categorySlug: CategorySlug;
  key: SeasonNudgeKey;
  /** Short hero line (SPEC §13 wording). */
  headline: string;
};

/** Nudges by the last month of the season they appear in (SPEC §13). */
const NUDGE_BY_MONTH: Readonly<Partial<Record<number, SeasonNudge>>> = {
  3: {
    nextSeason: "spring",
    categorySlug: "yard-cleanup",
    key: "spring-yard-cleanup",
    headline: "Spring's nearly here — book a yard cleanup",
  },
  5: {
    nextSeason: "summer",
    categorySlug: "lawn-mowing",
    key: "lawn-mowing-season",
    headline: "Lawn-mowing season is starting — find a mowing pro",
  },
  8: {
    nextSeason: "fall",
    categorySlug: "gutter-cleaning",
    key: "fall-gutter-cleanup",
    headline: "Fall's coming — book gutter and leaf cleanup",
  },
  11: {
    nextSeason: "winter",
    categorySlug: "snow-ice-removal",
    key: "snow-contract",
    headline: "Snow's coming — lock in a seasonal snow contract before the first storm",
  },
};

/**
 * The "what's next" nudge for an instant: null except in the last month of a season
 * (March, May, August, November in `timeZone`, default Halifax).
 */
export function seasonNudgeFor(
  date: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): SeasonNudge | null {
  const nudge = NUDGE_BY_MONTH[localMonth(date, timeZone)];
  return nudge ? { ...nudge } : null;
}
