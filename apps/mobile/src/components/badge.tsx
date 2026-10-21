import { StyleSheet, View } from "react-native";

import { colors, radius } from "@/theme";

import { Icon, type IconName } from "./icon.tsx";
import { Text } from "./text.tsx";

export type BadgeProps = {
  label: string;
  /** Pill background; defaults to the ground colour. */
  background?: string;
  textColor?: string;
  icon?: IconName;
  iconColor?: string;
  size?: "md" | "sm";
};

/** Non-interactive pill label, e.g. "Verified", "Pro", "Now booking fall visits". */
export function Badge({
  label,
  background = colors.ground,
  textColor = colors.ink,
  icon,
  iconColor,
  size = "md",
}: BadgeProps) {
  return (
    <View
      style={[styles.badge, { backgroundColor: background, height: size === "md" ? 30 : 24 }]}
      accessible
      accessibilityLabel={label}
    >
      {icon ? <Icon name={icon} size={size === "md" ? 16 : 13} color={iconColor ?? textColor} /> : null}
      <Text variant="caption" style={{ color: textColor, fontSize: size === "md" ? 12.5 : 12 }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
  },
});
