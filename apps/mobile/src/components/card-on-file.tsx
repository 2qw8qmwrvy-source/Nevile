import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { icons } from "@/components/icon.tsx";
import { Text } from "@/components/text.tsx";
import { FormAlert } from "@/lib/auth-ui.tsx";
import { useSaveCard } from "@/lib/cards.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { colors } from "@/theme";

/**
 * The saved card a recurring series or snow contract is charged to, with a button to add
 * or change it right here (the customer stays on the booking screen).
 */
export function CardOnFile({
  charged,
  missing,
}: {
  /** Around the card label: "Each visit is charged to" … ", 3 days before it." */
  charged: { before: string; after?: string };
  /** Why a card is needed, shown when there's none yet. */
  missing: string;
}) {
  const trpc = useTRPC();
  const card = useQuery(trpc.cards.get.queryOptions());
  const saving = useSaveCard();
  return (
    <Card style={styles.section}>
      <Text variant="heading">Payment card</Text>
      {card.isPending ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading your card" />
      ) : card.data ? (
        <>
          <Text>
            {charged.before} <Text variant="bodyStrong">{card.data.label}</Text>
            {charged.after ?? "."}
          </Text>
          <View style={styles.start}>
            <Button
              label="Change card"
              variant="ghost"
              size="sm"
              loading={saving.busy}
              onPress={saving.save}
            />
          </View>
        </>
      ) : (
        <>
          <Text tone="muted">{missing}</Text>
          <Button
            label="Add a card"
            icon={icons.card}
            variant="secondary"
            fullWidth
            loading={saving.busy}
            onPress={saving.save}
          />
        </>
      )}
      {saving.problem ? <FormAlert tone="error" message={saving.problem} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  start: { alignItems: "flex-start" },
});
