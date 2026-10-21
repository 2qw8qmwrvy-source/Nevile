import type { Category } from "@nevile/core";
import { ScrollView, StyleSheet, View } from "react-native";

import { SEASON_COPY } from "@/lib/season.ts";
import { cardShadow, colors, radius, type Season, seasons } from "@/theme";

import { Badge } from "./badge.tsx";
import { Button } from "./button.tsx";
import { Chip } from "./chip.tsx";
import { SeasonScene } from "./season-scene.tsx";
import { Text } from "./text.tsx";

export type SeasonHeroProps = {
  season: Season;
  featured: readonly Category[];
  onSelectCategory: (category: Category) => void;
};

/** Seasonal hero card: re-themes its tint, illustration, copy and featured categories by season. */
export function SeasonHero({ season, featured, onSelectCategory }: SeasonHeroProps) {
  const copy = SEASON_COPY[season];
  const lead = featured[0];
  return (
    <View style={styles.card}>
      <SeasonScene season={season} />
      <View style={styles.body}>
        <Badge
          label={copy.badge}
          background={colors.surface}
          icon={copy.icon}
          iconColor={seasons[season].accent}
        />
        <Text variant="title" style={styles.title}>
          {copy.title}
        </Text>
        <Text tone="muted">{copy.message}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipScroll}
          accessibilityLabel={`Popular in ${copy.label.toLowerCase()}`}
        >
          {featured.map((category) => (
            <Chip
              key={category.slug}
              label={category.name}
              onPress={() => onSelectCategory(category)}
            />
          ))}
        </ScrollView>
        {lead ? (
          <Button
            label={`Find ${lead.name.toLowerCase()}`}
            fullWidth
            onPress={() => onSelectCategory(lead)}
            accessibilityHint={`Search for ${lead.name.toLowerCase()} pros near you`}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card + 4,
    overflow: "hidden",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...cardShadow,
  },
  body: { padding: 16, gap: 8 },
  title: { marginTop: 6 },
  chipScroll: { marginHorizontal: -16, marginVertical: 6 },
  chips: { gap: 8, paddingHorizontal: 16, paddingVertical: 4 },
});
