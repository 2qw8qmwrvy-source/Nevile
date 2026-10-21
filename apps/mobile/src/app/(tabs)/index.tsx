import type { Category } from "@nevile/core";
import { DEFAULT_CATEGORIES, SEASONAL_CATEGORY_SLUGS } from "@nevile/core";
import { router } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { CategoryTile } from "@/components/category-tile.tsx";
import { Icon, icons } from "@/components/icon.tsx";
import { Screen } from "@/components/screen.tsx";
import { SeasonHero } from "@/components/season-hero.tsx";
import { Text } from "@/components/text.tsx";
import { seasonalCategories } from "@/lib/categories.ts";
import { currentSeason, greetingFor } from "@/lib/season.ts";
import { colors, MIN_TOUCH, radius, space } from "@/theme";

const HOW_IT_WORKS = [
  {
    title: "Find a local pro",
    body: "See only businesses whose service area covers your address, with ratings and Verified badges.",
  },
  {
    title: "Book or request a quote",
    body: "Instant Book a fixed price, or describe the job and get a quote. Chat opens right away.",
  },
  {
    title: "Pay in the app",
    body: "Prices are in CAD with one clear service fee. The business is paid once the job is confirmed.",
  },
] as const;

function openSearch(category?: Category) {
  router.navigate(
    category ? { pathname: "/search", params: { category: category.slug } } : "/search",
  );
}

export default function HomeScreen() {
  const { season, greeting } = useMemo(() => {
    const now = new Date();
    return { season: currentSeason(now), greeting: greetingFor(now) };
  }, []);
  const featured = seasonalCategories(season);
  const inSeason = new Set<string>(SEASONAL_CATEGORY_SLUGS[season]);

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="caption" tone="primary" style={styles.brand} accessibilityRole="text">
          NEVILE
        </Text>
        <Text variant="display">{greeting}</Text>
        <Text tone="muted">Book trusted local help for your home, all year round.</Text>
      </View>

      <Pressable
        accessibilityRole="search"
        accessibilityLabel="Search for a service"
        accessibilityHint="Opens search"
        onPress={() => openSearch()}
        style={({ pressed }) => [styles.searchEntry, pressed && styles.searchPressed]}
      >
        <Icon name={icons.search} size={20} color={colors.muted} />
        <Text style={{ color: colors.placeholder }}>Lawn mowing, snow removal…</Text>
      </Pressable>

      <SeasonHero season={season} featured={featured} onSelectCategory={openSearch} />

      <View style={styles.section}>
        <Text variant="title" style={styles.sectionTitle}>
          Browse services
        </Text>
        <View style={styles.grid}>
          {pairs(DEFAULT_CATEGORIES).map((row) => (
            <View key={row.map((c) => c.slug).join("+")} style={styles.gridRow}>
              {row.map((category) => (
                <CategoryTile
                  key={category.slug}
                  category={category}
                  season={season}
                  inSeason={inSeason.has(category.slug)}
                  onPress={() => openSearch(category)}
                />
              ))}
              {row.length === 1 ? <View style={styles.gridFiller} /> : null}
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text variant="title" style={styles.sectionTitle}>
          How it works
        </Text>
        <View style={styles.steps}>
          {HOW_IT_WORKS.map((step, index) => (
            <View
              key={step.title}
              style={[styles.step, index > 0 && styles.stepDivider]}
              accessible
              accessibilityLabel={`Step ${index + 1}: ${step.title}. ${step.body}`}
            >
              <View style={styles.stepNumber}>
                <Text variant="bodyStrong" tone="onPrimary">
                  {index + 1}
                </Text>
              </View>
              <View style={styles.stepBody}>
                <Text variant="bodyStrong">{step.title}</Text>
                <Text variant="small" tone="muted">
                  {step.body}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </Screen>
  );
}

function pairs<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
}

const styles = StyleSheet.create({
  header: { gap: 4, marginBottom: space.md },
  brand: { letterSpacing: 1.2, marginBottom: 4 },
  searchEntry: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: space.lg,
    borderRadius: radius.input + 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchPressed: { borderColor: colors.borderStrong },
  section: { marginTop: space.xl },
  sectionTitle: { marginBottom: 12 },
  grid: { gap: 10 },
  gridRow: { flexDirection: "row", gap: 10 },
  gridFiller: { flex: 1 },
  steps: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingHorizontal: 16,
  },
  step: { flexDirection: "row", gap: 14, paddingVertical: 14, minHeight: MIN_TOUCH },
  stepDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBody: { flex: 1, gap: 2 },
});
