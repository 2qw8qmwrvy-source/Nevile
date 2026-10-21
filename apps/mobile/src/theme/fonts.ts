/**
 * Seasons font files, loaded once by the root layout with expo-font's `useFonts`. Only the
 * faces the theme uses are bundled (per-weight imports keep the other ~20 files out of the
 * app). To use another weight, add it here and a matching name in `fontFamily`.
 */
import { BricolageGrotesque_700Bold } from "@expo-google-fonts/bricolage-grotesque/700Bold";
import { Figtree_400Regular } from "@expo-google-fonts/figtree/400Regular";
import { Figtree_500Medium } from "@expo-google-fonts/figtree/500Medium";
import { Figtree_600SemiBold } from "@expo-google-fonts/figtree/600SemiBold";

import { fontFamily } from "./index.ts";

export const fontAssets = {
  [fontFamily.displayBold]: BricolageGrotesque_700Bold,
  [fontFamily.body]: Figtree_400Regular,
  [fontFamily.bodyMedium]: Figtree_500Medium,
  [fontFamily.bodySemiBold]: Figtree_600SemiBold,
} satisfies Record<(typeof fontFamily)[keyof typeof fontFamily], number>;
