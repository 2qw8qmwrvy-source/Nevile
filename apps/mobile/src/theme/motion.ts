/**
 * Motion presets (SPEC §16): subtle and fast, 150–250 ms. Reanimated's layout animations
 * and `withTiming` default to `ReduceMotion.System`, so every preset here is skipped
 * automatically when the device asks for reduced motion; native stack transitions use
 * `useStackAnimation` for the same reason.
 */
import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  useReducedMotion,
  type WithTimingConfig,
} from "react-native-reanimated";

export const duration = { fast: 150, base: 200, slow: 250 } as const;

const easeOut = Easing.out(Easing.cubic);

/** Press feedback: scale down on touch, spring back on release. */
export const pressIn: WithTimingConfig = { duration: duration.fast, easing: easeOut };
export const pressOut: WithTimingConfig = { duration: duration.base, easing: easeOut };

/** Content appearing: a short fade with an 8pt rise. */
export const enterUp = FadeInDown.duration(duration.slow)
  .easing(easeOut)
  .withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] });
/** Content appearing in place (banners, alerts, season crossfade). */
export const enterFade = FadeIn.duration(duration.base).easing(easeOut);
export const exitFade = FadeOut.duration(duration.fast).easing(easeOut);
/** Siblings sliding into place when something above them appears or disappears. */
export const layoutShift = LinearTransition.duration(duration.base).easing(easeOut);

/** Native stack transition that becomes a crossfade when reduced motion is on. */
export function useStackAnimation(): "fade" | "slide_from_right" {
  return useReducedMotion() ? "fade" : "slide_from_right";
}
