import { formatCad } from "@nevile/core";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { Badge } from "@/components/badge.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Icon } from "@/components/icon.tsx";
import { Screen } from "@/components/screen.tsx";
import { Text } from "@/components/text.tsx";
import { IconButton, TopBar, topBarIcons } from "@/components/top-bar.tsx";
import { openWebsitePage } from "@/lib/links.ts";
import { NEIGHBOURS_COPY } from "@/lib/neighbours.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { colors, radius, seasons, space } from "@/theme";
import { enterUp } from "@/theme/motion.ts";

/** Nevile Neighbours (SPEC §15): what it is, how it works, and the public numbers. */
export default function NeighboursRoute() {
  const trpc = useTRPC();
  const impact = useQuery(trpc.community.impact.queryOptions());
  const enabled = impact.data?.enabled ?? false;
  const stats = impact.data
    ? [
        { label: "Donated", value: formatCad(impact.data.donatedCents) },
        { label: "Card fees", value: formatCad(impact.data.feesCents) },
        { label: "Paid to local pros", value: formatCad(impact.data.paidToProsCents) },
        { label: "Jobs completed", value: impact.data.completedJobs.toLocaleString("en-CA") },
      ]
    : null;

  return (
    <Screen
      edges={["top", "bottom", "left", "right"]}
      header={
        <TopBar
          leading={
            <IconButton
              icon={topBarIcons.back}
              label="Back"
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
            />
          }
        />
      }
    >
      <Animated.View entering={enterUp} style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroIcon}>
            <Icon name={NEIGHBOURS_COPY.icon} size={26} color={seasons.fall.accent} />
          </View>
          {impact.data ? (
            <Badge
              label={enabled ? "Now open" : "Launching soon"}
              size="sm"
              background={enabled ? seasons.spring.tint : colors.surface}
            />
          ) : null}
        </View>
        <Text variant="display">{NEIGHBOURS_COPY.name}</Text>
        <Text>{NEIGHBOURS_COPY.pitch}</Text>
        {!enabled && impact.data ? (
          <Text variant="small" tone="muted">
            {NEIGHBOURS_COPY.launchingSoon}
          </Text>
        ) : null}
      </Animated.View>

      <View style={styles.section}>
        <Text variant="title">How it works</Text>
        {NEIGHBOURS_COPY.steps.map((step, index) => (
          <Card key={step.title} style={styles.step}>
            <View style={styles.stepNumber}>
              <Text variant="bodyStrong" tone="onPrimary">
                {index + 1}
              </Text>
            </View>
            <View style={styles.stepText}>
              <Text variant="bodyStrong">{step.title}</Text>
              <Text variant="small" tone="muted">
                {step.body}
              </Text>
            </View>
          </Card>
        ))}
      </View>

      <View style={styles.section}>
        <Text variant="title">Impact so far</Text>
        {stats ? (
          <View style={styles.stats}>
            {stats.map((stat) => (
              <Card key={stat.label} style={styles.stat}>
                <Text variant="small" tone="muted">
                  {stat.label}
                </Text>
                <Text variant="title">{stat.value}</Text>
              </Card>
            ))}
          </View>
        ) : (
          <Text tone="muted">{impact.isError ? "We couldn't load the numbers." : "Loading…"}</Text>
        )}
        <Text variant="small" tone="muted">
          {NEIGHBOURS_COPY.privacy}
        </Text>
        <Button
          variant="secondary"
          label="Open the impact page"
          fullWidth
          onPress={() => void openWebsitePage("/neighbours/impact")}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: space.sm,
    padding: 20,
    borderRadius: radius.card + 4,
    backgroundColor: seasons.fall.tint,
  },
  heroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  section: { marginTop: space.xl, gap: 12 },
  step: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { flex: 1, gap: 2 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stat: { flexBasis: "47%", flexGrow: 1, gap: 4 },
});
