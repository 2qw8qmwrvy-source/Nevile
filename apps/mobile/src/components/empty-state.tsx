import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, space } from "@/theme";

import { Icon, type IconName } from "./icon.tsx";
import { Text } from "./text.tsx";

export type EmptyStateProps = {
  icon: IconName;
  title: string;
  message: string;
  /** Icon tile background; defaults to the spring tint. */
  tint?: string;
  iconColor?: string;
  action?: ReactNode;
};

/** Centered illustration + copy for screens with nothing to show yet. */
export function EmptyState({
  icon,
  title,
  message,
  tint = colors.tabPill,
  iconColor = colors.primary,
  action,
}: EmptyStateProps) {
  return (
    <View style={styles.root}>
      <View style={[styles.iconTile, { backgroundColor: tint }]}>
        <Icon name={icon} size={34} color={iconColor} />
      </View>
      <Text variant="title" style={styles.title}>
        {title}
      </Text>
      <Text tone="muted" style={styles.message}>
        {message}
      </Text>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.lg,
    paddingVertical: space.xxl,
  },
  iconTile: {
    width: 80,
    height: 80,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.lg,
  },
  title: { textAlign: "center" },
  message: { textAlign: "center", marginTop: space.sm, maxWidth: 320 },
  action: { marginTop: space.lg },
});
