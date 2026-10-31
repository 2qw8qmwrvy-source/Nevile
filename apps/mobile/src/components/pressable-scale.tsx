import { useState } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { pressIn, pressOut } from "@/theme/motion.ts";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PressableScaleProps = Omit<PressableProps, "style"> & {
  /** A style, or a function of the pressed state like Pressable's. */
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  /** Scale while pressed; 1 turns the effect off. */
  pressedScale?: number;
};

/**
 * Pressable with a subtle scale-down while touched (SPEC §16 press feedback). The scale is
 * skipped under reduced motion; pressed colours in `style` still apply.
 */
export function PressableScale({
  style,
  pressedScale = 0.97,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const [pressed, setPressed] = useState(false);
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const resolved = typeof style === "function" ? style({ pressed }) : style;

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(event) => {
        setPressed(true);
        if (pressedScale !== 1) scale.set(withTiming(pressedScale, pressIn));
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPressed(false);
        scale.set(withTiming(1, pressOut));
        onPressOut?.(event);
      }}
      style={[resolved, animatedStyle]}
    />
  );
}
