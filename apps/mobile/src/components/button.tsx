import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, type PressableProps, StyleSheet, View } from "react-native";

import { colors, MIN_TOUCH, radius } from "@/theme";

import { Icon, type IconName } from "./icon.tsx";
import { Text } from "./text.tsx";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "md" | "sm";

export type ButtonProps = Omit<PressableProps, "children" | "style"> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  loading?: boolean;
  fullWidth?: boolean;
  /** Overrides the background of the primary variant (e.g. a season accent). */
  accentColor?: string;
  trailing?: ReactNode;
};

const palette: Record<ButtonVariant, { bg: string; pressed: string; fg: string; border: string }> =
  {
    primary: {
      bg: colors.primary,
      pressed: colors.primaryPressed,
      fg: colors.onPrimary,
      border: colors.primary,
    },
    secondary: {
      bg: colors.surface,
      pressed: colors.ghostPressed,
      fg: colors.ink,
      border: colors.border,
    },
    ghost: {
      bg: "transparent",
      pressed: colors.ghostPressed,
      fg: colors.primary,
      border: "transparent",
    },
  };

export function Button({
  label,
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  fullWidth = false,
  accentColor,
  disabled,
  trailing,
  accessibilityLabel,
  ...rest
}: ButtonProps) {
  const p = palette[variant];
  const accent = variant === "primary" ? accentColor : undefined;
  const usesAccent = accent !== undefined;
  const bg = accent ?? p.bg;
  const inactive = disabled === true || loading;
  // Small buttons are visually 36pt; hitSlop keeps the touch target at 44pt.
  const height = size === "md" ? 48 : 36;
  const slop = Math.max(0, (MIN_TOUCH - height) / 2);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      hitSlop={slop}
      style={({ pressed }) => [
        styles.base,
        {
          height,
          paddingHorizontal: size === "md" ? 20 : 14,
          backgroundColor: inactive ? colors.border : pressed && !usesAccent ? p.pressed : bg,
          borderColor: inactive ? colors.border : usesAccent ? bg : p.border,
          // An arbitrary accent has no pressed shade, so dim it instead.
          opacity: pressed && usesAccent ? 0.85 : 1,
        },
        fullWidth && styles.fullWidth,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.content}>
          {icon ? <Icon name={icon} size={18} color={inactive ? colors.muted : p.fg} /> : null}
          <Text
            variant="bodyStrong"
            style={{ color: inactive ? colors.muted : p.fg, fontSize: size === "md" ? 16 : 14 }}
            numberOfLines={1}
          >
            {label}
          </Text>
          {trailing}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  fullWidth: { alignSelf: "stretch" },
  content: { flexDirection: "row", alignItems: "center", gap: 8 },
});
