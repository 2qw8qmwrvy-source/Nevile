import { Text as RNText, type TextProps as RNTextProps, StyleSheet } from "react-native";

import { colors, type TypographyVariant, typography } from "@/theme";

export type TextTone = "ink" | "muted" | "primary" | "onPrimary" | "danger";

export type TextProps = RNTextProps & {
  variant?: TypographyVariant;
  tone?: TextTone;
};

const toneColor: Record<TextTone, string> = {
  ink: colors.ink,
  muted: colors.muted,
  primary: colors.primary,
  onPrimary: colors.onPrimary,
  danger: colors.danger,
};

/** Text with Seasons typography. Display/title variants are announced as headers. */
export function Text({
  variant = "body",
  tone = "ink",
  style,
  accessibilityRole,
  ...rest
}: TextProps) {
  const isHeading = variant === "display" || variant === "title" || variant === "heading";
  return (
    <RNText
      accessibilityRole={accessibilityRole ?? (isHeading ? "header" : undefined)}
      maxFontSizeMultiplier={variant === "display" ? 1.6 : 2}
      style={[styles.base, typography[variant], { color: toneColor[tone] }, style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  base: { includeFontPadding: false },
});
