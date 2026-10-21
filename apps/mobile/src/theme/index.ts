/**
 * Mobile theme: Seasons tokens from @nevile/tokens plus the few derived values the
 * approved mockup uses. The app is light-only for now (app.json userInterfaceStyle).
 */
import { color, radius, type Season, seasonColor, space } from "@nevile/tokens";
import type { TextStyle } from "react-native";

export type { Season };
export { radius, space };

export const colors = {
  ...color,
  /** Placeholder text (from the mockup); still 4.5:1 on white. */
  placeholder: "#5E6862",
  /** Pressed/hover border on cards. */
  borderStrong: "#B8C2B4",
  /** Pressed background for ghost buttons and rows. */
  ghostPressed: "#EEF1EA",
  /** Selected tab pill (spring tint). */
  tabPill: seasonColor.spring.tint,
  primaryPressed: color.primaryHover,
} as const;

export const seasons = seasonColor;

/** Hairline card shadow from the mockup: 0 1px 2px rgba(24,33,29,.06). */
export const cardShadow = {
  boxShadow: "0px 1px 2px rgba(24, 33, 29, 0.06)",
} as const;

/** Minimum touch target (Apple HIG 44pt). */
export const MIN_TOUCH = 44;

/**
 * Seasons fonts: Bricolage Grotesque for display text, Figtree for body text. Each weight is
 * its own family name (registered in `fonts.ts` and loaded by the root layout), because
 * Android ignores `fontWeight` for custom fonts or fakes it. Set the family for the weight
 * you want and leave `fontWeight` unset.
 */
export const fontFamily = {
  displayBold: "BricolageGrotesque_700Bold",
  body: "Figtree_400Regular",
  bodyMedium: "Figtree_500Medium",
  bodySemiBold: "Figtree_600SemiBold",
} as const;

export const typography = {
  display: {
    fontFamily: fontFamily.displayBold,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  title: {
    fontFamily: fontFamily.displayBold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.2,
  },
  heading: {
    fontFamily: fontFamily.displayBold,
    fontSize: 17,
    lineHeight: 22,
  },
  body: {
    fontFamily: fontFamily.body,
    fontSize: 15,
    lineHeight: 22,
  },
  bodyStrong: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 15,
    lineHeight: 22,
  },
  small: {
    fontFamily: fontFamily.body,
    fontSize: 13.5,
    lineHeight: 19,
  },
  caption: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    lineHeight: 16,
  },
} as const satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;
