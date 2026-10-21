import type { Category } from "@nevile/core";
import { StyleSheet, View } from "react-native";

import { CATEGORY_ICONS, primarySeasonOf } from "@/lib/categories.ts";
import { colors, type Season, seasons } from "@/theme";

import { Badge } from "./badge.tsx";
import { Card } from "./card.tsx";
import { Icon } from "./icon.tsx";
import { Text } from "./text.tsx";

export type CategoryTileProps = {
  category: Category;
  /** The current season; tiles featured this season get an "In season" badge. */
  inSeason?: boolean;
  season: Season;
  onPress: () => void;
};

export function CategoryTile({ category, inSeason = false, season, onPress }: CategoryTileProps) {
  const tileSeason = inSeason ? season : primarySeasonOf(category.slug);
  const tint = tileSeason ? seasons[tileSeason].tint : colors.ground;
  const accent = tileSeason ? seasons[tileSeason].accent : colors.primary;
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={inSeason ? `${category.name}, in season` : category.name}
      accessibilityHint={`Search for ${category.name.toLowerCase()} pros`}
      style={styles.tile}
    >
      <View style={styles.top}>
        <View style={[styles.iconTile, { backgroundColor: tint }]}>
          <Icon name={CATEGORY_ICONS[category.slug]} size={22} color={accent} />
        </View>
        {inSeason ? <Badge label="In season" size="sm" background={seasons[season].tint} /> : null}
      </View>
      <Text variant="bodyStrong" numberOfLines={2} style={styles.name}>
        {category.name}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, minHeight: 112, justifyContent: "space-between", gap: 12 },
  top: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 4 },
  iconTile: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  name: { lineHeight: 20 },
});
