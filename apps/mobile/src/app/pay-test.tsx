import { formatCad } from "@nevile/core";
import { useQueryClient } from "@tanstack/react-query";
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
import { outcomeProblem } from "@/lib/payments.ts";
import { askForPush } from "@/lib/push.ts";
import { useTRPC, useTRPCClient } from "@/lib/trpc.tsx";
import { apiErrorMessage } from "@/lib/trpc-client.ts";
import { space } from "@/theme";

/**
 * Development only: stands in for Stripe's payment sheet when the API uses the test
 * payment provider. No real money moves; the API refuses this in production.
 */
export default function PayTestRoute() {
  const params = useLocalSearchParams<{
    checkoutId: string;
    amountCents: string;
    capture: string;
    description: string;
  }>();
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const hold = params.capture === "hold";
  const amount = formatCad(Number(params.amountCents) || 0);

  async function pay() {
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await client.bookings.payTestCheckout.mutate({
        checkoutId: params.checkoutId ?? "",
      });
      void queryClient.invalidateQueries({ queryKey: trpc.bookings.list.queryKey() });
      if (outcome.status === "booked" || outcome.status === "requested") {
        // Close this sheet, then show the booking in place of the booking screen.
        router.dismiss();
        router.replace({ pathname: "/bookings/[id]", params: { id: outcome.bookingId, new: "1" } });
        void askForPush(client);
        return;
      }
      setProblem(outcomeProblem(outcome));
    } catch (error) {
      setProblem(apiErrorMessage(error, "The test payment didn't go through."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Test payment"
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
        <FormAlert tone="info" message="Test mode: no real money moves and no card is needed." />
        <Card style={styles.section}>
          <Text variant="small" tone="muted">
            {hold ? "Held on your card until the pro accepts" : "You pay"}
          </Text>
          <Text variant="display">{amount}</Text>
          <Text>{params.description}</Text>
        </Card>
        {problem ? <FormAlert tone="error" message={problem} /> : null}
        <Button
          label={hold ? "Authorize test card" : "Pay with test card"}
          icon={icons.card}
          fullWidth
          loading={busy}
          onPress={() => void pay()}
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
