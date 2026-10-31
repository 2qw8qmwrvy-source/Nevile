import { Stack } from "expo-router";

import { colors } from "@/theme";

/**
 * Sign-in and sign-up, presented as one modal from the root stack. Screens switch with
 * `router.replace` so the stack stays one deep and Close/back always leaves the flow.
 */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.ground },
        animation: "fade",
      }}
    />
  );
}
