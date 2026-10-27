import { useFonts } from "expo-font";
import { DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import { OnboardingGate } from "@/components/onboarding-gate.tsx";
import { PushBridge } from "@/components/push-bridge.tsx";
import { ApiProvider } from "@/lib/trpc.tsx";
import { colors } from "@/theme";
import { fontAssets } from "@/theme/fonts.ts";
import { useStackAnimation } from "@/theme/motion.ts";

// Keep the splash screen up until the Seasons fonts are registered, so text never re-flows
// from the system font. The files ship in the bundle, so this takes a few milliseconds.
void SplashScreen.preventAutoHideAsync();

// Deep links straight into a modal (e.g. nevile://sign-in) still get the tabs underneath.
export const unstable_settings = { anchor: "(tabs)" };

// Nevile is light-first; app.json pins userInterfaceStyle to "light" until a dark palette exists.
const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.ground,
    card: colors.surface,
    text: colors.ink,
    border: colors.border,
    notification: colors.danger,
  },
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  // On a load error, carry on: unregistered families fall back to the system font.
  const ready = fontsLoaded || fontError !== null;
  // Slides between screens, or a crossfade when the device asks for reduced motion.
  const animation = useStackAnimation();

  useEffect(() => {
    if (fontError) console.warn("[fonts] could not load the Seasons fonts", fontError);
  }, [fontError]);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <ApiProvider>
      <ThemeProvider value={navigationTheme}>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.ground },
            animation,
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)" options={{ presentation: "modal" }} />
          <Stack.Screen name="welcome" options={{ presentation: "fullScreenModal" }} />
          <Stack.Screen name="neighbours" />
          <Stack.Screen name="pros/[slug]" />
          <Stack.Screen name="bookings/[id]" />
          <Stack.Screen name="book" />
          <Stack.Screen name="pay-test" options={{ presentation: "modal" }} />
          <Stack.Screen name="recurring" />
          <Stack.Screen name="contract" />
          <Stack.Screen name="card" />
          <Stack.Screen name="card-test" options={{ presentation: "modal" }} />
          <Stack.Screen name="quotes/index" />
          <Stack.Screen name="quotes/new" options={{ presentation: "modal" }} />
          <Stack.Screen name="quotes/[groupId]" />
          <Stack.Screen name="inbox/[conversationId]" />
          <Stack.Screen name="business/index" />
          <Stack.Screen name="business/calendar" />
          <Stack.Screen name="business/snow-route" />
          <Stack.Screen name="business/bookings/[id]" />
          <Stack.Screen name="business/series/[id]" />
          <Stack.Screen name="business/quotes/index" />
          <Stack.Screen name="business/quotes/[requestId]" />
          <Stack.Screen name="business/listing" />
          <Stack.Screen name="business/profile" />
          <Stack.Screen name="business/service" />
          <Stack.Screen name="business/area" />
          <Stack.Screen name="business/photos" />
          <Stack.Screen name="business/team" />
          <Stack.Screen name="business/member" />
          <Stack.Screen name="business/windows" />
          <Stack.Screen name="business/payouts" />
          <Stack.Screen name="payout-return" options={{ animation: "none" }} />
        </Stack>
        <OnboardingGate />
        <PushBridge />
      </ThemeProvider>
    </ApiProvider>
  );
}
