import type { ReactNode } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";

import { cardShadow, colors, radius } from "@/theme";

import { PressableScale, type PressableScaleProps } from "./pressable-scale.tsx";

type CardBaseProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Removes the default 16pt padding (e.g. for edge-to-edge rows). */
  flush?: boolean;
};

export type CardProps = CardBaseProps &
  (
    | { onPress?: undefined }
    | (Omit<PressableScaleProps, "children" | "style"> & {
        onPress: PressableScaleProps["onPress"];
      })
  );

/** White surface card with the Seasons hairline border. Pressable when `onPress` is set. */
export function Card({ children, style, flush = false, ...rest }: CardProps) {
  const base = [styles.card, !flush && styles.padded];
  if (rest.onPress) {
    return (
      <PressableScale
        accessibilityRole="button"
        pressedScale={0.98}
        {...rest}
        style={({ pressed }) => [...base, pressed && styles.pressed, style]}
      >
        {children}
      </PressableScale>
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
