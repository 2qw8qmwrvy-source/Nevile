import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, MIN_TOUCH, radius, space } from "@/theme";

import { Icon, type IconName } from "./icon.tsx";
import { PressableScale } from "./pressable-scale.tsx";

export const topBarIcons = {
  back: { ios: "chevron.left", android: "arrow_back" },
  close: { ios: "xmark", android: "close" },
} as const satisfies Record<string, IconName>;

/** Round 44pt icon button for top bars (Close, Back). */
export function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
}: {
  icon: IconName;
  /** Accessible name, e.g. "Close". */
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      pressedScale={0.94}
      style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}
    >
      <Icon name={icon} size={18} color={colors.ink} />
    </PressableScale>
  );
}

/** Row above a screen's content: a leading control and an optional trailing one. */
export function TopBar({ leading, trailing }: { leading?: ReactNode; trailing?: ReactNode }) {
  return (
    <View style={styles.bar}>
      <View style={styles.slot}>{leading}</View>
      <View style={[styles.slot, styles.trailing]}>{trailing}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: MIN_TOUCH + space.sm,
    paddingHorizontal: 12,
    paddingTop: space.sm,
  },
  slot: { minWidth: MIN_TOUCH, flexDirection: "row", alignItems: "center" },
  trailing: { justifyContent: "flex-end" },
  iconButton: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconPressed: { backgroundColor: colors.ghostPressed },
});
