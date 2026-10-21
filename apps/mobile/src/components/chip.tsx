import { Pressable, type PressableProps, StyleSheet } from "react-native";

import { colors, MIN_TOUCH, radius } from "@/theme";

import { Icon, type IconName } from "./icon.tsx";
import { Text } from "./text.tsx";

export type ChipProps = Omit<PressableProps, "children" | "style"> & {
  label: string;
  selected?: boolean;
  icon?: IconName;
};

/** Toggleable filter pill. Visually 36pt tall with hitSlop to a 44pt target. */
export function Chip({ label, selected = false, icon, accessibilityLabel, ...rest }: ChipProps) {
  const fg = selected ? colors.onPrimary : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      hitSlop={(MIN_TOUCH - 36) / 2}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.selected : pressed ? styles.pressed : undefined,
      ]}
      {...rest}
    >
      {icon ? (
        <Icon name={icon} size={16} color={selected ? colors.onPrimary : colors.primary} />
      ) : null}
      <Text variant="bodyStrong" style={[styles.label, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selected: { backgroundColor: colors.primary, borderColor: colors.primary },
  pressed: { backgroundColor: colors.ghostPressed },
  label: { fontSize: 14 },
});
