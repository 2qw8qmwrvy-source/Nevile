/**
 * Mobile theme: Seasons tokens from @nevile/tokens plus the few derived values the
 * approved mockup uses. The app is light-only for now (app.json userInterfaceStyle).
 */
import { color, radius, type Season, seasonColor, space } from "@nevile/tokens";
import { Platform, type TextStyle } from "react-native";

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
 * Bricolage Grotesque / Figtree are not bundled yet, so both families fall back to the
 * platform system font. Swap these once the Expo Google Fonts packages are added.
 */
const systemFamily = Platform.select({ ios: "System", default: undefined });

export const fontFamily = {
  display: systemFamily,
  body: systemFamily,
} as const;

export const typography = {
  display: {
    fontFamily: fontFamily.display,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  title: {
    fontFamily: fontFamily.display,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  heading: {
    fontFamily: fontFamily.display,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "700",
  },
  body: {
    fontFamily: fontFamily.body,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "400",
  },
  bodyStrong: {
    fontFamily: fontFamily.body,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
  small: {
    fontFamily: fontFamily.body,
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: "400",
  },
  caption: {
    fontFamily: fontFamily.body,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
  },
} as const satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;
