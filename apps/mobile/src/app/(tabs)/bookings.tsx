import { useQuery } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { Badge } from "@/components/badge.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { Icon, icons } from "@/components/icon.tsx";
import { ListRow } from "@/components/list-row.tsx";
import { PressableScale } from "@/components/pressable-scale.tsx";
import { Screen } from "@/components/screen.tsx";
import { Text } from "@/components/text.tsx";
import { useSession } from "@/lib/auth.ts";
import { FormAlert } from "@/lib/auth-ui.tsx";
import { type CustomerBooking, statusColors } from "@/lib/bookings.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { colors, space } from "@/theme";

function BookingRow({ booking }: { booking: CustomerBooking }) {
  const tone = statusColors(booking.status);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${booking.service.title} with ${booking.business.name}, ${booking.window.label}, ${booking.statusLabel}`}
      onPress={() => router.push(`/bookings/${booking.id}`)}
    >
      <Card style={styles.row}>
        <View style={styles.rowTop}>
          <View style={styles.shrink}>
            <Text variant="bodyStrong">{booking.service.title}</Text>
            <Text variant="small" tone="muted">
              {booking.business.name}
            </Text>
          </View>
          <Badge
            label={booking.statusLabel}
            size="sm"
            background={tone.background}
            textColor={tone.text}
          />
        </View>
        <Text variant="small">{booking.window.label}</Text>
      </Card>
    </PressableScale>
  );
}

function Section({ title, bookings }: { title: string; bookings: CustomerBooking[] }) {
  if (bookings.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text variant="title">{title}</Text>
      {bookings.map((booking) => (
        <BookingRow key={booking.id} booking={booking} />
      ))}
    </View>
  );
}

/** The customer's bookings: what needs them, what's coming up, and what's done. */
export default function BookingsScreen() {
  const trpc = useTRPC();
  const session = useSession();
  const signedIn = Boolean(session.data?.user);
  const list = useQuery({ ...trpc.bookings.list.queryOptions(), enabled: signedIn });
  const refetch = list.refetch;
  // Bookings can change elsewhere (the website, the pro), so check again on every visit.
  useFocusEffect(
    useCallback(() => {
      if (signedIn) void refetch();
    }, [signedIn, refetch]),
  );

  if (!signedIn) {
    return (
      <Screen title="Bookings">
        <Card style={styles.signIn}>
          <Icon name={icons.bookings} size={28} color={colors.primary} />
          <Text variant="heading">Sign in to see your bookings</Text>
          <Text tone="muted">
            Your upcoming visits, receipts and anything that needs you will be here.
          </Text>
          <Button label="Sign in" fullWidth onPress={() => router.push("/sign-in")} />
        </Card>
      </Screen>
    );
  }

  const data = list.data;
  const empty = data && data.needsYou.length + data.upcoming.length + data.past.length === 0;
  return (
    <Screen title="Bookings">
      <Card flush style={styles.quotes}>
        <ListRow
          label="Your quotes"
          description="Requests you've sent and the prices pros sent back"
          icon={icons.chat}
          onPress={() => router.push("/quotes")}
        />
      </Card>
      {list.isPending ? (
        <ActivityIndicator
          color={colors.primary}
          accessibilityLabel="Loading"
          style={styles.spinner}
        />
      ) : list.isError ? (
        <View style={styles.section}>
          <FormAlert tone="error" message="We couldn't load your bookings right now." />
          <Button label="Try again" variant="secondary" onPress={() => list.refetch()} />
        </View>
      ) : empty ? (
        <EmptyState
          icon={icons.booked}
          title="No bookings yet"
          message="Find a local pro and book a time, or ask a few for a quote. Your visits and receipts show up here."
          action={
            <Button
              label="Find a pro"
              icon={icons.search}
              onPress={() => router.navigate("/search")}
            />
          }
        />
      ) : data ? (
        <View style={styles.page}>
          <Section title="Needs you" bookings={data.needsYou} />
          <Section title="Upcoming" bookings={data.upcoming} />
          <Section title="Past" bookings={data.past} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  spinner: { marginVertical: space.xl },
  page: { gap: space.lg },
  section: { gap: 10 },
  row: { gap: 6 },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  shrink: { flex: 1, minWidth: 0 },
  signIn: { gap: space.sm, alignItems: "flex-start" },
  quotes: { marginBottom: space.lg, overflow: "hidden" },
});
