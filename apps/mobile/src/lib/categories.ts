import {
  type Category,
  type CategorySlug,
  DEFAULT_CATEGORIES,
  isCategorySlug,
  SEASONAL_CATEGORY_SLUGS,
  type Season,
} from "@nevile/core";

import type { IconName } from "@/components/icon.tsx";

/** Icon for each fixed category (SPEC §3). */
export const CATEGORY_ICONS: Record<CategorySlug, IconName> = {
  "lawn-mowing": { ios: "leaf", android: "grass" },
  "snow-ice-removal": { ios: "snowflake", android: "ac_unit" },
  "house-cleaning": { ios: "sparkles", android: "cleaning_services" },
  "gutter-cleaning": { ios: "cloud.rain", android: "roofing" },
  "leaf-cleanup": { ios: "wind", android: "eco" },
  "window-washing": { ios: "window.casement", android: "window" },
  "pressure-washing": { ios: "drop.fill", android: "water_drop" },
  "yard-cleanup": { ios: "tree", android: "yard" },
};

/** The season a category is most associated with, used to tint its tile. */
export function primarySeasonOf(slug: CategorySlug): Season | undefined {
  const order: readonly Season[] = ["winter", "fall", "spring", "summer"];
  return order.find((season) => SEASONAL_CATEGORY_SLUGS[season][0] === slug)
    ?? order.find((season) => SEASONAL_CATEGORY_SLUGS[season].includes(slug));
}

export function categoryBySlug(slug: string | undefined): Category | undefined {
  if (!isCategorySlug(slug)) return undefined;
  return DEFAULT_CATEGORIES.find((category) => category.slug === slug);
}

/** Featured categories for a season, in relevance order. */
export function seasonalCategories(season: Season): Category[] {
  return SEASONAL_CATEGORY_SLUGS[season]
    .map((slug) => DEFAULT_CATEGORIES.find((category) => category.slug === slug))
    .filter((category): category is Category => category !== undefined);
}

/** Case-insensitive match on category name or description. */
export function matchCategories(query: string): Category[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...DEFAULT_CATEGORIES];
  return DEFAULT_CATEGORIES.filter(
    (category) =>
      category.name.toLowerCase().includes(q) || category.description.toLowerCase().includes(q),
  );
}
