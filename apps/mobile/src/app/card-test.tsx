import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { icons } from "@/components/icon.tsx";
import { Screen } from "@/components/screen.tsx";
import { Text } from "@/components/text.tsx";
import { IconButton, TopBar, topBarIcons } from "@/components/top-bar.tsx";
import { FormAlert } from "@/lib/auth-ui.tsx";
import { setupProblem, useCardStored } from "@/lib/cards.ts";
import { useTRPCClient } from "@/lib/trpc.tsx";
import { apiErrorMessage } from "@/lib/trpc-client.ts";
import { space } from "@/theme";

/**
 * Development only: stands in for Stripe's card sheet when the API uses the test payment
 * provider. Saves a test card, or one whose charges are declined (to try paused series
 * and contracts). The API refuses this in production.
 */
export default function CardTestRoute() {
  const { setupId } = useLocalSearchParams<{ setupId: string }>();
  const client = useTRPCClient();
  const stored = useCardStored();
  const [busy, setBusy] = useState<"good" | "declining" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function save(declining: boolean) {
    setBusy(declining ? "declining" : "good");
    setProblem(null);
    try {
      const finished = await client.cards.payTestSetup.mutate({
        setupId: setupId ?? "",
        declining,
      });
      if (finished.status === "saved") {
        stored(finished.card);
        router.back();
        return;
      }
      setProblem(setupProblem(finished));
    } catch (error) {
      setProblem(apiErrorMessage(error, "The test card wasn't saved."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen
      title="Test card"
      edges={["top", "bottom", "left", "right"]}
      header={
        <TopBar
          trailing={
            <IconButton icon={topBarIcons.close} label="Close" onPress={() => router.back()} />
          }
        />
      }
    >
      <View style={styles.page}>
        <FormAlert tone="info" message="Test mode: no real card is needed or charged." />
        <Card style={styles.section}>
          <Text variant="heading">Save a card</Text>
          <Text tone="muted">
            Recurring visits and snow contracts are charged to this card later.
          </Text>
        </Card>
        {problem ? <FormAlert tone="error" message={problem} /> : null}
        <Button
          label="Save test card"
          icon={icons.card}
          fullWidth
          loading={busy === "good"}
          disabled={busy !== null}
          onPress={() => void save(false)}
        />
        <Button
          label="Save a card that declines"
          variant="secondary"
          fullWidth
          loading={busy === "declining"}
          disabled={busy !== null}
          onPress={() => void save(true)}
        />
        <Button label="Cancel" variant="ghost" fullWidth onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { gap: space.md },
  section: { gap: 6 },
});
