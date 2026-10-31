import { StyleSheet, View } from "react-native";

import { colors, radius } from "@/theme";

import type { IconName } from "./icon.tsx";
import { Text } from "./text.tsx";
import { IconButton } from "./top-bar.tsx";

const stepIcons = {
  less: { ios: "minus", android: "remove" },
  more: { ios: "plus", android: "add" },
} as const satisfies Record<string, IconName>;

/**
 * A value with − and + buttons, for times and dates on a phone. Screen readers get it as
 * an adjustable control: swipe up or down to change it.
 */
export function Stepper({
  label,
  value,
  onLess,
  onMore,
  canLess,
  canMore,
  disabled = false,
}: {
  label: string;
  /** The current value as shown, e.g. "8:00 a.m.". */
  value: string;
  onLess: () => void;
  onMore: () => void;
  canLess: boolean;
  canMore: boolean;
  disabled?: boolean;
}) {
  return (
    <View
      style={styles.root}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: value }}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        if (disabled) return;
        if (event.nativeEvent.actionName === "increment" && canMore) onMore();
        if (event.nativeEvent.actionName === "decrement" && canLess) onLess();
      }}
    >
      <Text variant="small" tone="muted" importantForAccessibility="no">
        {label}
      </Text>
      <View style={styles.row} importantForAccessibility="no-hide-descendants">
        <IconButton
          icon={stepIcons.less}
          label={`Decrease ${label}`}
          disabled={disabled || !canLess}
          onPress={onLess}
        />
        <Text variant="bodyStrong" style={styles.value}>
          {value}
        </Text>
        <IconButton
          icon={stepIcons.more}
          label={`Increase ${label}`}
          disabled={disabled || !canMore}
          onPress={onMore}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: "stretch",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  value: { flex: 1, textAlign: "center" },
});
