export const SLUG_MAX_LENGTH = 60;

/**
 * URL slug from a display name: ASCII lowercase kebab-case, accents folded
 * ("Côté Déneigement" → "cote-deneigement"). Returns "" when nothing usable remains.
 */
export function slugify(input: string, maxLength = SLUG_MAX_LENGTH): string {
  return input
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}
