import { color, radius, SEASONS, type Season, seasonColor } from "@nevile/tokens";
import type { CSSProperties } from "react";

/**
 * Text-safe season colours. The token accents are used for fills and icons; for text and
 * for white-on-accent controls, spring and summer need a darker shade to meet WCAG AA
 * (4.5:1) on both white and the season tint. Values match the approved Seasons mockups.
 */
export const seasonInk: Record<Season, string> = {
  winter: "#2D6A9F",
  spring: "#2F6A2B",
  summer: "#8A560E",
  fall: "#A4471F",
};

/** Logo leaf colour per season (decorative). */
export const seasonLeaf: Record<Season, string> = {
  winter: "#BFD8EC",
  spring: "#BFE0A8",
  summer: "#F2C96B",
  fall: "#F0A77E",
};

type CssVars = CSSProperties & Record<`--${string}`, string>;

/**
 * Root CSS custom properties generated from @nevile/tokens, so the TS tokens stay the
 * single source of truth. globals.css maps these onto Tailwind's theme via `@theme inline`.
 */
export function tokenCssVars(): CssVars {
  const vars: CssVars = {
    "--nv-ground": color.ground,
    "--nv-surface": color.surface,
    "--nv-border": color.border,
    "--nv-ink": color.ink,
    "--nv-muted": color.muted,
    "--nv-primary": color.primary,
    "--nv-primary-hover": color.primaryHover,
    "--nv-on-primary": color.onPrimary,
    "--nv-danger": color.danger,
    "--nv-star": color.star,
    "--nv-radius-card": `${radius.card}px`,
    "--nv-radius-input": `${radius.input}px`,
  };
  for (const season of SEASONS) {
    vars[`--nv-${season}`] = seasonColor[season].accent;
    vars[`--nv-${season}-tint`] = seasonColor[season].tint;
    vars[`--nv-${season}-ink`] = seasonInk[season];
  }
  return vars;
}

/** CSS custom properties for the "current season" colours inside a season scope. */
export function seasonCssVars(season: Season): CssVars {
  return {
    "--season-accent": seasonColor[season].accent,
    "--season-tint": seasonColor[season].tint,
    "--season-ink": seasonInk[season],
    "--season-leaf": seasonLeaf[season],
  };
}
