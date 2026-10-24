import { StyleSheet, View } from "react-native";

import { colors, radius } from "@/theme";

import { PressableScale } from "./pressable-scale.tsx";
import { Text } from "./text.tsx";

/** One choice in a group: a radio, a title and an optional line of explanation. */
export function RadioCard({
  label,
  description,
  checked,
  disabled = false,
  onPress,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={description ? `${label}. ${description}` : label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      pressedScale={0.99}
      onPress={onPress}
      style={[styles.card, checked && styles.checked]}
    >
      <View style={[styles.radio, checked && styles.radioOn]} />
      <View style={styles.text}>
        <Text variant="bodyStrong">{label}</Text>
        {description ? (
          <Text variant="small" tone="muted">
            {description}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  checked: { borderColor: colors.primary, backgroundColor: colors.tabPill },
  radio: {
    width: 18,
    height: 18,
    marginTop: 2,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  radioOn: { borderColor: colors.primary, borderWidth: 6 },
  text: { flex: 1, minWidth: 0, gap: 2 },
});
