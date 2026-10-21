import { DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { colors } from "@/theme";

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
  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}
      >
        <Stack.Screen name="(tabs)" />
      </Stack>
    </ThemeProvider>
  );
}
