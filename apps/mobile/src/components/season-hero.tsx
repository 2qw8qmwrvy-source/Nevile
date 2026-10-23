import type { Category, SeasonNudge } from "@nevile/core";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { NUDGE_ACTIONS, SEASON_COPY } from "@/lib/season.ts";
import { cardShadow, colors, radius, type Season, seasons } from "@/theme";
import { enterFade, exitFade, layoutShift } from "@/theme/motion.ts";

import { Badge } from "./badge.tsx";
import { Button } from "./button.tsx";
import { Chip } from "./chip.tsx";
import { Icon } from "./icon.tsx";
import { SeasonScene } from "./season-scene.tsx";
import { Text } from "./text.tsx";

export type SeasonHeroProps = {
  /** The current season in Nova Scotia; never chosen by hand (SPEC §13). */
  season: Season;
  featured: readonly Category[];
  /** The "what's next" nudge in the last month of a season, if any. */
  nudge?: SeasonNudge | null;
  onSelectCategory: (category: Category) => void;
  onSelectNudge?: (nudge: SeasonNudge) => void;
};

/**
 * Seasonal hero card: its tint, illustration, copy and featured categories follow the
 * current month in Nova Scotia, crossfading when the season turns.
 */
export function SeasonHero({
  season,
  featured,
  nudge,
  onSelectCategory,
  onSelectNudge,
}: SeasonHeroProps) {
  const copy = SEASON_COPY[season];
  const lead = featured[0];
  return (
    <Animated.View layout={layoutShift} style={styles.card}>
      {/* Keyed by season so a change of season remounts and crossfades the content. */}
      <Animated.View key={season} entering={enterFade} exiting={exitFade}>
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
      </Animated.View>
      {nudge ? <NudgeStrip nudge={nudge} onPress={onSelectNudge} /> : null}
    </Animated.View>
  );
}

/** "Snow's coming…" strip in the next season's colours, below the hero body. */
function NudgeStrip({
  nudge,
  onPress,
}: {
  nudge: SeasonNudge;
  onPress?: (nudge: SeasonNudge) => void;
}) {
  const next = seasons[nudge.nextSeason];
  const nextCopy = SEASON_COPY[nudge.nextSeason];
  return (
    <Animated.View
      entering={enterFade}
      exiting={exitFade}
      style={[styles.nudge, { backgroundColor: next.tint }]}
    >
      <View style={styles.nudgeRow}>
        <View style={styles.nudgeIcon}>
          <Icon name={nextCopy.icon} size={18} color={next.accent} />
        </View>
        <Text variant="bodyStrong" style={styles.nudgeText}>
          {nudge.headline}
        </Text>
      </View>
      {onPress ? (
        <Button
          variant="secondary"
          size="sm"
          label={NUDGE_ACTIONS[nudge.key]}
          onPress={() => onPress(nudge)}
        />
      ) : null}
    </Animated.View>
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
  nudge: {
    gap: 12,
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  nudgeRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  nudgeIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  nudgeText: { flex: 1 },
});
