/** The fixed service category list managed by Nevile — SPEC §3. */

export const CATEGORY_SLUGS = [
  "lawn-mowing",
  "snow-ice-removal",
  "house-cleaning",
  "gutter-cleaning",
  "leaf-cleanup",
  "window-washing",
  "pressure-washing",
  "yard-cleanup",
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

export type Category = {
  slug: CategorySlug;
  name: string;
  description: string;
};

export const DEFAULT_CATEGORIES: readonly Category[] = [
  {
    slug: "lawn-mowing",
    name: "Lawn Mowing",
    description: "Regular mowing, edging and trimming to keep your lawn tidy all season.",
  },
  {
    slug: "snow-ice-removal",
    name: "Snow & Ice Removal",
    description: "Driveway, walkway and steps cleared after snowfall, plus salting for ice.",
  },
  {
    slug: "house-cleaning",
    name: "House Cleaning",
    description: "Recurring or one-time cleaning of kitchens, bathrooms, floors and living spaces.",
  },
  {
    slug: "gutter-cleaning",
    name: "Gutter Cleaning",
    description: "Leaves and debris removed from gutters and downspouts to prevent overflow.",
  },
  {
    slug: "leaf-cleanup",
    name: "Leaf Cleanup",
    description: "Raking, blowing and hauling away fallen leaves from lawns and garden beds.",
  },
  {
    slug: "window-washing",
    name: "Window Washing",
    description: "Streak-free cleaning of exterior and interior windows, frames and sills.",
  },
  {
    slug: "pressure-washing",
    name: "Pressure Washing",
    description: "Deep cleaning for driveways, decks, patios, fences and siding.",
  },
  {
    slug: "yard-cleanup",
    name: "Yard Cleanup",
    description: "Seasonal tidy-ups: debris removal, pruning, bed clearing and yard waste haul-away.",
  },
];

export function isCategorySlug(value: unknown): value is CategorySlug {
  return typeof value === "string" && (CATEGORY_SLUGS as readonly string[]).includes(value);
}
