import { addCalendarDays, formatCad, formatIsoDate, parseIsoDate } from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { BusinessScreen } from "@/components/business-screen.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Text } from "@/components/text.tsx";
import { FormAlert } from "@/lib/auth-ui.tsx";
import type { Membership } from "@/lib/business.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { apiErrorMessage } from "@/lib/trpc-client.ts";
import { colors, space } from "@/theme";

const day = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});
/** "2026-10-12" → "Oct 12" (dates, not instants). */
const dateText = (iso: string) => day.format(new Date(`${iso}T12:00:00Z`));
/** Payout periods run Monday to Sunday; the stored end is the next Monday. */
function periodText(start: string, end: string): string {
  const next = parseIsoDate(end);
  return `${dateText(start)} to ${dateText(next ? formatIsoDate(addCalendarDays(next, -1)) : end)}`;
}
const dueLabel = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Halifax",
  weekday: "long",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const PAYOUT_STATUS: Record<string, string> = {
  pending: "Sending",
  processing: "On its way",
  paid: "Paid",
  failed: "Didn't go through: we'll retry",
};

function Payouts({ membership }: { membership: Membership }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const businessId = membership.business.id;
  const isOwner = membership.role === "owner";
  const status = useQuery(trpc.payouts.status.queryOptions({ businessId }));
  const [returned, setReturned] = useState(false);
  const refresh = useMutation(
    trpc.payouts.refresh.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: trpc.payouts.status.queryKey({ businessId }) }),
    }),
  );
  const start = useMutation(
    trpc.payouts.start.mutationOptions({
      onSuccess: async ({ url }) => {
        // Stripe's secure page; when it's closed, ask whether payouts are ready now.
        await WebBrowser.openBrowserAsync(url, {
          controlsColor: colors.primary,
          dismissButtonStyle: "done",
        });
        setReturned(true);
        refresh.mutate({ businessId });
      },
    }),
  );

  if (status.isPending)
    return <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />;
  if (status.isError) return <FormAlert tone="error" message={apiErrorMessage(status.error)} />;
  const summary = status.data;

  return (
    <>
      <Text variant="display">Payouts</Text>
      <Card style={styles.section}>
        <Text variant="heading">
          {summary.payoutsEnabled ? "Payouts are set up" : "Set up payouts"}
        </Text>
        {summary.payoutsEnabled ? (
          <Text tone="muted">
            We send what you've earned every Monday for jobs confirmed the week before. Banks
            usually take 1 to 2 business days.
          </Text>
        ) : (
          <>
            <Text tone="muted">
              Our payment partner, Stripe, checks your identity and bank account so we can pay you.
              It takes about 5 minutes.
            </Text>
            {summary.bookingsPaused ? (
              <FormAlert
                tone="error"
                message="New bookings are paused until payout setup is finished."
              />
            ) : summary.setupDueAt ? (
              <FormAlert
                tone="info"
                message={`Finish by ${dueLabel.format(summary.setupDueAt)} to keep taking bookings. After that, upcoming bookings are cancelled and refunded.`}
              />
            ) : null}
            {returned && refresh.isPending ? <Text tone="muted">Checking your setup…</Text> : null}
            {returned && refresh.data && !refresh.data.payoutsEnabled ? (
              <FormAlert
                tone="info"
                message="Stripe is still checking your details, or something is missing. Continue setup to see what's left."
              />
            ) : null}
            {start.error ? <FormAlert tone="error" message={apiErrorMessage(start.error)} /> : null}
            {isOwner ? (
              <Button
                label={summary.hasAccount ? "Continue payout setup" : "Set up payouts"}
                fullWidth
                loading={start.isPending}
                accessibilityHint="Opens Stripe's secure page"
                onPress={() => start.mutate({ businessId })}
              />
            ) : (
              <Text>Only the owner can set up payouts.</Text>
            )}
          </>
        )}
      </Card>

      <Card style={styles.section}>
        <Text variant="heading">Earnings</Text>
        <Text tone="muted">
          Waiting to be paid out:{" "}
          <Text variant="bodyStrong">{formatCad(summary.upcomingCents)}</Text> (your price plus HST,
          less Nevile's 3% fee, before any refunds).
        </Text>
        {summary.payouts.length === 0 ? (
          <Text tone="muted">No payouts yet.</Text>
        ) : (
          summary.payouts.map((payout) => (
            <View
              key={payout.id}
              style={styles.payout}
              accessible
              accessibilityLabel={`${periodText(payout.periodStart, payout.periodEnd)}: ${formatCad(payout.amountCents)}, ${PAYOUT_STATUS[payout.status] ?? payout.status}`}
            >
              <View style={styles.grow}>
                <Text>{periodText(payout.periodStart, payout.periodEnd)}</Text>
                <Text variant="small" tone="muted">
                  {PAYOUT_STATUS[payout.status] ?? payout.status}
                </Text>
              </View>
              <Text variant="bodyStrong">{formatCad(payout.amountCents)}</Text>
            </View>
          ))
        )}
      </Card>
    </>
  );
}

/** Payout setup (Stripe's page) and weekly payouts (SPEC §7, §19). */
export default function BusinessPayoutsRoute() {
  const { businessId } = useLocalSearchParams<{ businessId?: string }>();
  return (
    <BusinessScreen businessId={businessId} managed>
      {(membership) => <Payouts key={membership.business.id} membership={membership} />}
    </BusinessScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  grow: { flex: 1, minWidth: 0 },
  payout: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
