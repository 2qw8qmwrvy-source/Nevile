import type { Category } from "@nevile/core";
import {
  calculateCharge,
  DEFAULT_CATEGORIES,
  formatCad,
  isCategorySlug,
  SEASONAL_CATEGORY_SLUGS,
} from "@nevile/core";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { Badge } from "@/components/badge.tsx";
import { Card } from "@/components/card.tsx";
import { CategoryTile } from "@/components/category-tile.tsx";
import { Chip } from "@/components/chip.tsx";
import { Icon, icons } from "@/components/icon.tsx";
import { Screen } from "@/components/screen.tsx";
import { SeasonHero } from "@/components/season-hero.tsx";
import { Text } from "@/components/text.tsx";
import { VerificationBanner } from "@/components/verification-banner.tsx";
import { CATEGORY_ICONS, categoryBySlug, seasonalCategories } from "@/lib/categories.ts";
import { useMe } from "@/lib/me.ts";
import { NEIGHBOURS_COPY } from "@/lib/neighbours.ts";
import { useSeasonNow } from "@/lib/season.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { useEmailVerification } from "@/lib/verification.ts";
import { colors, MIN_TOUCH, radius, seasons, space } from "@/theme";
import { enterUp, layoutShift } from "@/theme/motion.ts";

/** SPEC §7 worked example, computed by the real fee rules so the copy can't drift. */
const NS_EXAMPLE = calculateCharge({
  priceCents: 6000,
  province: "NS",
  businessTaxRegistered: true,
});

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
    body: `One clear service fee, and HST at Nova Scotia's rate. A ${formatCad(NS_EXAMPLE.priceCents)} job comes to ${formatCad(NS_EXAMPLE.totalCents)} with the ${formatCad(NS_EXAMPLE.serviceFeeCents)} fee and ${formatCad(NS_EXAMPLE.taxCents)} HST. The pro is paid once the job is confirmed.`,
  },
] as const;

function openSearch(category?: Pick<Category, "slug">) {
  router.navigate(
    category ? { pathname: "/search", params: { category: category.slug } } : "/search",
  );
}

export default function HomeScreen() {
  const trpc = useTRPC();
  const { season, nudge, greeting } = useSeasonNow();
  const { me } = useMe();
  const verification = useEmailVerification();
  const neighbours = useQuery(trpc.community.status.queryOptions());

  const featured = seasonalCategories(season);
  const inSeason = new Set<string>(SEASONAL_CATEGORY_SLUGS[season]);
  // SPEC §16: the welcome's interests personalise the homepage.
  const picks = (me.data?.onboarding.interests ?? [])
    .filter(isCategorySlug)
    .map((slug) => categoryBySlug(slug))
    .filter((category): category is Category => category !== undefined);

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="caption" tone="primary" style={styles.brand} accessibilityRole="text">
          NEVILE
        </Text>
        <Text variant="display">{greeting}</Text>
        <Text tone="muted">Trusted local help for your home, all year round in Nova Scotia.</Text>
      </View>

      {verification.needed ? (
        <View style={styles.banner}>
          <VerificationBanner
            email={verification.email}
            sending={verification.sending}
            cooldown={verification.cooldown}
            notice={verification.notice}
            onResend={() => void verification.resend()}
          />
        </View>
      ) : null}

      <Animated.View layout={layoutShift}>
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

        <SeasonHero
          season={season}
          featured={featured}
          nudge={nudge}
          onSelectCategory={openSearch}
          onSelectNudge={(selected) => openSearch({ slug: selected.categorySlug })}
        />

        {picks.length > 0 ? (
          <Animated.View entering={enterUp} style={styles.section}>
            <Text variant="title" style={styles.sectionTitle}>
              Your services
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
              contentContainerStyle={styles.chips}
              accessibilityLabel="Services you picked"
            >
              {picks.map((category) => (
                <Chip
                  key={category.slug}
                  label={category.name}
                  icon={CATEGORY_ICONS[category.slug]}
                  onPress={() => openSearch(category)}
                />
              ))}
            </ScrollView>
          </Animated.View>
        ) : null}

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

        <Card
          onPress={() => router.push("/neighbours")}
          accessibilityLabel={`${NEIGHBOURS_COPY.name}. ${NEIGHBOURS_COPY.pitch}${
            neighbours.data?.enabled === false ? " Launching soon." : ""
          }`}
          accessibilityHint="Opens the community program page"
          style={[styles.section, styles.neighbours]}
        >
          <View style={styles.neighboursTop}>
            <View style={styles.neighboursIcon}>
              <Icon name={NEIGHBOURS_COPY.icon} size={22} color={seasons.fall.accent} />
            </View>
            {neighbours.data?.enabled === false ? (
              <Badge label="Launching soon" size="sm" background={seasons.fall.tint} />
            ) : null}
          </View>
          <Text variant="heading">{NEIGHBOURS_COPY.name}</Text>
          <Text variant="small" tone="muted">
            {NEIGHBOURS_COPY.pitch}
          </Text>
          <View style={styles.more}>
            <Text variant="bodyStrong" tone="primary">
              How it works
            </Text>
            <Icon name={icons.chevronRight} size={14} color={colors.primary} />
          </View>
        </Card>

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
      </Animated.View>
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
  banner: { marginBottom: space.md },
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
  chipScroll: { marginHorizontal: -20, flexGrow: 0 },
  chips: { gap: 8, paddingHorizontal: 20, paddingVertical: 4 },
  grid: { gap: 10 },
  gridRow: { flexDirection: "row", gap: 10 },
  gridFiller: { flex: 1 },
  neighbours: { gap: 6 },
  neighboursTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  neighboursIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: seasons.fall.tint,
    alignItems: "center",
    justifyContent: "center",
  },
  more: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
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
