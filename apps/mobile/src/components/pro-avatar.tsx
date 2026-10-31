import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

import { mediaUrl } from "@/lib/media.ts";
import { colors } from "@/theme";

import { Text } from "./text.tsx";

/** "Harbour Lawn & Snow" → "HL". */
function initialsOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}

type ProAvatarProps = {
  name: string;
  logoUrl: string | null;
  size?: number;
  /** "surface" on tinted backgrounds, where the default tile would vanish. */
  tone?: "soft" | "surface";
};

/** A business's logo, or its initials on a soft tile when it has none. Decorative. */
export function ProAvatar({ name, logoUrl, size = 52, tone = "soft" }: ProAvatarProps) {
  const box = { width: size, height: size, borderRadius: size * 0.28 };
  if (logoUrl) {
    return (
      <Image
        source={{ uri: mediaUrl(logoUrl) }}
        style={[styles.logo, box]}
        contentFit="cover"
        accessible={false}
      />
    );
  }
  return (
    <View
      style={[styles.tile, box, tone === "surface" ? styles.surface : styles.soft]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text
        variant="title"
        tone="primary"
        style={{ fontSize: size * 0.36, lineHeight: size * 0.44 }}
      >
        {initialsOf(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  logo: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tile: { alignItems: "center", justifyContent: "center" },
  soft: { backgroundColor: "#E6F0EA" },
  surface: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
});
