import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { Icon, icons } from "@/components/icon.tsx";
import { Screen } from "@/components/screen.tsx";
import { Text } from "@/components/text.tsx";
import { IconButton, TopBar, topBarIcons } from "@/components/top-bar.tsx";
import { useSession } from "@/lib/auth.ts";
import { FormAlert } from "@/lib/auth-ui.tsx";
import { shortDate } from "@/lib/quotes.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { colors, space } from "@/theme";

/** The customer's quote requests, newest first (SPEC §20). */
export default function QuotesRoute() {
  const trpc = useTRPC();
  const session = useSession();
  const signedIn = Boolean(session.data?.user);
  const quotes = useQuery({ ...trpc.quotes.list.queryOptions(), enabled: signedIn });
  const back = () => (router.canGoBack() ? router.back() : router.replace("/bookings"));

  return (
    <Screen
      title="Your quotes"
      scroll={false}
      edges={["top", "bottom", "left", "right"]}
      header={
        <TopBar leading={<IconButton icon={topBarIcons.back} label="Back" onPress={back} />} />
      }
    >
      {!signedIn ? (
        <EmptyState
          icon={icons.chat}
          title="Sign in to see your quotes"
          message="Quote requests and replies live in your Nevile account."
          action={<Button label="Sign in" onPress={() => router.push("/sign-in")} />}
        />
      ) : quotes.isPending ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />
      ) : quotes.isError ? (
        <View style={styles.list}>
          <FormAlert tone="error" message="We couldn't load your quotes right now." />
          <Button label="Try again" variant="secondary" onPress={() => quotes.refetch()} />
        </View>
      ) : quotes.data.length === 0 ? (
        <EmptyState
          icon={icons.chat}
          title="No quote requests yet"
          message="Pick up to 3 pros in search and ask them for a price. They reply within 3 days."
          action={
            <Button
              label="Find pros"
              variant="secondary"
              onPress={() => router.navigate("/search")}
            />
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={quotes.isRefetching}
              onRefresh={() => void quotes.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          {quotes.data.map((group) => (
            <Card
              key={group.id}
              onPress={() =>
                router.push({ pathname: "/quotes/[groupId]", params: { groupId: group.id } })
              }
              accessibilityLabel={`${group.category.name}, ${group.summary}, asked ${shortDate.format(group.createdAt)}`}
              style={styles.card}
            >
              <View style={styles.grow}>
                <Text variant="heading">{group.category.name}</Text>
                <Text variant="bodyStrong" tone="primary">
                  {group.summary}
                </Text>
                <Text variant="small" tone="muted" numberOfLines={2}>
                  {shortDate.format(group.createdAt)} ·{" "}
                  {group.pros.map((pro) => pro.business.name).join(", ")}
                </Text>
              </View>
              <Icon name={icons.chevronRight} size={16} color={colors.muted} />
            </Card>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm, paddingBottom: space.xl },
  card: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
});
