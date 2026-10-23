import { StyleSheet, View } from "react-native";

import { colors } from "@/theme";

import { Badge } from "./badge.tsx";
import { Icon, type IconName } from "./icon.tsx";
import { Text } from "./text.tsx";

const starIcon = { ios: "star.fill", android: "star" } as const satisfies IconName;
const shieldIcon = {
  ios: "checkmark.shield",
  android: "verified_user",
} as const satisfies IconName;
const boltIcon = { ios: "bolt.fill", android: "bolt" } as const satisfies IconName;

/** "★ 4.8 (12 reviews)", or "New on Nevile" before the first review (SPEC §18). */
export function Rating({ rating }: { rating: { average: number; count: number } | null }) {
  if (!rating) {
    return (
      <Text variant="small" tone="muted">
        New on Nevile
      </Text>
    );
  }
  const reviews = `${rating.count} ${rating.count === 1 ? "review" : "reviews"}`;
  return (
    <View
      style={styles.rating}
      accessible
      accessibilityLabel={`Rated ${rating.average.toFixed(1)} out of 5 from ${reviews}`}
    >
      <Icon name={starIcon} size={14} color={colors.star} />
      <Text variant="bodyStrong">{rating.average.toFixed(1)}</Text>
      <Text variant="small" tone="muted">
        ({reviews})
      </Text>
    </View>
  );
}

/** Pro (discloses the search boost), Verified and Instant Book badges. */
export function ProBadges({
  badges,
}: {
  badges: { verified: boolean; pro: boolean; instantBook: boolean };
}) {
  if (!badges.verified && !badges.pro && !badges.instantBook) return null;
  return (
    <View style={styles.badges}>
      {badges.pro ? (
        <Badge label="Pro" size="sm" background={colors.ink} textColor={colors.onPrimary} />
      ) : null}
      {badges.verified ? (
        <Badge
          label="Verified"
          size="sm"
          icon={shieldIcon}
          background="#E6F0EA"
          textColor={colors.primary}
        />
      ) : null}
      {badges.instantBook ? (
        <Badge
          label="Instant Book"
          size="sm"
          icon={boltIcon}
          background={colors.surface}
          textColor={colors.primary}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rating: { flexDirection: "row", alignItems: "center", gap: 4 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
