/**
 * Seasons design tokens (SPEC.md §13), shared by web and mobile.
 */

export const color = {
  ground: "#F5F6F1",
  surface: "#FFFFFF",
  border: "#E1E5DC",
  ink: "#18211D",
  muted: "#4F5A54",
  primary: "#1E5B43",
  primaryHover: "#174A36",
  onPrimary: "#FFFFFF",
  danger: "#B42318",
  star: "#B7791F",
} as const;

export const SEASONS = ["winter", "spring", "summer", "fall"] as const;
export type Season = (typeof SEASONS)[number];

export const seasonColor: Record<Season, { accent: string; tint: string }> = {
  winter: { accent: "#2D6A9F", tint: "#E3EEF7" },
  spring: { accent: "#3F7F3A", tint: "#E5F1E1" },
  summer: { accent: "#A86A12", tint: "#FBEFD9" },
  fall: { accent: "#A4471F", tint: "#F7E4DA" },
};

export const font = {
  display: "Bricolage Grotesque",
  body: "Figtree",
} as const;

export const radius = {
  card: 18,
  input: 12,
  pill: 999,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;
