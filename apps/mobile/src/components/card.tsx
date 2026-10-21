import type { ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";

import { cardShadow, colors, radius } from "@/theme";

type CardBaseProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Removes the default 16pt padding (e.g. for edge-to-edge rows). */
  flush?: boolean;
};

export type CardProps = CardBaseProps &
  ({ onPress?: undefined } | (Omit<PressableProps, "children" | "style"> & { onPress: PressableProps["onPress"] }));

/** White surface card with the Seasons hairline border. Pressable when `onPress` is set. */
export function Card({ children, style, flush = false, ...rest }: CardProps) {
  const base = [styles.card, !flush && styles.padded];
  if (rest.onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        {...rest}
        style={({ pressed }) => [...base, pressed && styles.pressed, style]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[...base, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    ...cardShadow,
  },
  padded: { padding: 16 },
  pressed: { borderColor: colors.borderStrong, backgroundColor: colors.ghostPressed },
});
