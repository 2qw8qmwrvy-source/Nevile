import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { StyleSheet, View } from "react-native";

import { colors } from "@/theme";

import { Card } from "./card.tsx";
import { Icon, icons } from "./icon.tsx";
import { ProAvatar } from "./pro-avatar.tsx";
import { ProBadges, Rating } from "./pro-meta.tsx";
import { Text } from "./text.tsx";

export type SearchResult = inferRouterOutputs<AppRouter>["search"]["query"]["results"][number];

/** One search result (SPEC §18): name, badges, rating, the matching service and distance. */
export function ProCard({ result, onPress }: { result: SearchResult; onPress: () => void }) {
  const distance = result.distanceText ? `${result.distanceText} away · ` : "";
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${result.name}. ${result.service.title}, ${result.service.priceText}. ${distance}${result.areaText}.`}
      accessibilityHint="Opens this pro's page"
      style={styles.card}
    >
      <ProAvatar name={result.name} logoUrl={result.logoUrl} />
      <View style={styles.body}>
        <Text variant="heading" numberOfLines={2}>
          {result.name}
        </Text>
        <ProBadges badges={result.badges} />
        <Rating rating={result.rating} />
        <Text variant="body">
          <Text variant="bodyStrong">{result.service.title}</Text> · {result.service.priceText}
          {result.serviceCount > 1 ? (
            <Text tone="muted"> · {result.serviceCount - 1} more</Text>
          ) : null}
        </Text>
        <Text variant="small" tone="muted">
          {distance}
          {result.areaText} · {result.cancellationPolicy} cancellation
        </Text>
      </View>
      <Icon name={icons.chevronRight} size={16} color={colors.muted} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  body: { flex: 1, minWidth: 0, gap: 4 },
});
