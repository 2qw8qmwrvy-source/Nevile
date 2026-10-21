import { Pressable, type PressableProps, StyleSheet, View } from "react-native";

import { colors, MIN_TOUCH } from "@/theme";

import { Icon, type IconName, icons } from "./icon.tsx";
import { Text } from "./text.tsx";

export type ListRowProps = Omit<PressableProps, "children" | "style"> & {
  label: string;
  description?: string;
  icon: IconName;
  /** Destructive rows (e.g. Sign out) use the danger colour and hide the chevron. */
  destructive?: boolean;
  /** Draws a divider above the row when it follows another row. */
  divider?: boolean;
};

/** A tappable settings-style row: icon tile, label, optional description, chevron. */
export function ListRow({
  label,
  description,
  icon,
  destructive = false,
  divider = false,
  accessibilityLabel,
  accessibilityHint,
  ...rest
}: ListRowProps) {
  const tone = destructive ? colors.danger : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint ?? description}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && styles.pressed]}
      {...rest}
    >
      <View style={styles.iconTile}>
        <Icon name={icon} size={20} color={tone} />
      </View>
      <View style={styles.body}>
        <Text variant="bodyStrong" style={destructive ? { color: colors.danger } : undefined}>
          {label}
        </Text>
        {description ? (
          <Text variant="small" tone="muted">
            {description}
          </Text>
        ) : null}
      </View>
      {destructive ? null : <Icon name={icons.chevronRight} size={16} color={colors.muted} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: MIN_TOUCH + 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.ghostPressed },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.ground,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, minWidth: 0 },
});
