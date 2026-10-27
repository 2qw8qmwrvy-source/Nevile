import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { Icon, icons } from "@/components/icon.tsx";
import { Screen } from "@/components/screen.tsx";
import { Text } from "@/components/text.tsx";
import { IconButton, TopBar, topBarIcons } from "@/components/top-bar.tsx";
import { VerificationBanner } from "@/components/verification-banner.tsx";
import { FormAlert } from "@/lib/auth-ui.tsx";
import { useSaveCard } from "@/lib/cards.ts";
import { useMe } from "@/lib/me.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { apiErrorMessage } from "@/lib/trpc-client.ts";
import { useEmailVerification } from "@/lib/verification.ts";
import { colors, radius, space } from "@/theme";
import { enterUp } from "@/theme/motion.ts";

/**
 * Account → Payment method (SPEC §21): the one card saved for recurring visits and snow
 * contracts. One-off bookings are paid at checkout and don't use it. Stripe keeps the card;
 * Nevile only sees its brand, last four digits and expiry.
 */
export default function CardRoute() {
  const trpc = useTRPC();
  const { user, me } = useMe();
  const verification = useEmailVerification();
  const card = useQuery({ ...trpc.cards.get.queryOptions(), enabled: user !== null });
  const saving = useSaveCard();
  const back = () => (router.canGoBack() ? router.back() : router.replace("/account"));
  const locked = me.data?.verified === false;

  return (
    <Screen
      title="Payment method"
      edges={["top", "bottom", "left", "right"]}
      header={
        <TopBar leading={<IconButton icon={topBarIcons.back} label="Back" onPress={back} />} />
      }
    >
      {!user ? (
        <EmptyState
          icon={icons.card}
          title="Sign in to save a card"
          message="A saved card pays for recurring visits and snow contracts."
          action={<Button label="Sign in" onPress={() => router.push("/sign-in")} />}
        />
      ) : card.isPending ? (
        <ActivityIndicator
          color={colors.primary}
          accessibilityLabel="Loading"
          style={styles.spinner}
        />
      ) : card.isError ? (
        <View style={styles.section}>
          <FormAlert
            tone="error"
            message={apiErrorMessage(card.error, "We couldn't load your card right now.")}
          />
          <Button label="Try again" variant="secondary" onPress={() => card.refetch()} />
        </View>
      ) : (
        <Animated.View entering={enterUp} style={styles.page}>
          {locked ? (
            <VerificationBanner
              email={verification.email}
              sending={verification.sending}
              cooldown={verification.cooldown}
              notice={verification.notice}
              onResend={() => void verification.resend()}
            />
          ) : null}
          <Card style={styles.section}>
            {card.data ? (
              <View style={styles.cardRow}>
                <View style={styles.cardTile}>
                  <Icon name={icons.card} size={22} color={colors.primary} />
                </View>
                <View style={styles.grow}>
                  <Text variant="bodyStrong">{card.data.label}</Text>
                  <Text variant="small" tone="muted">
                    Expires {card.data.expires}
                  </Text>
                </View>
              </View>
            ) : (
              <>
                <Text variant="heading">No card saved</Text>
                <Text tone="muted">
                  Add a card to book recurring visits or sign up for a snow contract.
                </Text>
              </>
            )}
            {saving.problem ? <FormAlert tone="error" message={saving.problem} /> : null}
            <Button
              label={card.data ? "Replace card" : "Add a card"}
              icon={icons.card}
              variant={card.data ? "secondary" : "primary"}
              fullWidth
              loading={saving.busy}
              disabled={locked}
              onPress={saving.save}
            />
          </Card>
          <Text variant="small" tone="muted">
            Recurring visits are charged to this card 3 days before each visit, and snow contracts
            as their terms say. One-off bookings are paid at checkout. Stripe stores the card;
            Nevile never sees the full number.
          </Text>
        </Animated.View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  spinner: { marginVertical: space.xl },
  page: { gap: space.lg },
  section: { gap: 12 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardTile: {
    width: 44,
    height: 44,
    borderRadius: radius.input,
    backgroundColor: colors.ground,
    alignItems: "center",
    justifyContent: "center",
  },
  grow: { flex: 1, minWidth: 0 },
});
