import { formatCad } from "@nevile/core";
import { useQuery } from "@tanstack/react-query";
import { type Href, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { StyleSheet, View } from "react-native";

import { Badge } from "@/components/badge.tsx";
import { BusinessScreen } from "@/components/business-screen.tsx";
import { Card } from "@/components/card.tsx";
import { type IconName, icons } from "@/components/icon.tsx";
import { ListRow } from "@/components/list-row.tsx";
import { Text } from "@/components/text.tsx";
import { FormAlert } from "@/lib/auth-ui.tsx";
import { canManage, type Membership, ROLE_NAMES } from "@/lib/business.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { colors, seasons } from "@/theme";

const toolIcons = {
  quotes: { ios: "text.bubble", android: "request_quote" },
  listing: { ios: "list.bullet.rectangle", android: "storefront" },
  team: { ios: "person.2", android: "group" },
  payouts: { ios: "banknote", android: "payments" },
  page: { ios: "safari", android: "open_in_new" },
  snow: { ios: "snowflake", android: "ac_unit" },
} as const satisfies Record<string, IconName>;

function Hub({ membership }: { membership: Membership }) {
  const trpc = useTRPC();
  const businessId = membership.business.id;
  const manager = canManage(membership.role);
  const listing = useQuery(trpc.listing.get.queryOptions({ businessId }));
  const inbox = useQuery(trpc.businessBookings.inbox.queryOptions({ businessId }));
  const quotes = useQuery({
    ...trpc.businessQuotes.list.queryOptions({ businessId }),
    enabled: manager,
  });
  const payouts = useQuery({
    ...trpc.payouts.status.queryOptions({ businessId }),
    enabled: manager,
  });
  const refetchInbox = inbox.refetch;
  const refetchQuotes = quotes.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetchInbox();
      if (manager) void refetchQuotes();
    }, [refetchInbox, refetchQuotes, manager]),
  );

  const to = (pathname: string): Href => ({ pathname, params: { businessId } }) as Href;
  const waiting = [
    {
      count: inbox.data?.requests.length ?? 0,
      label: (n: number) => `${n} booking ${n === 1 ? "request" : "requests"} to answer`,
      href: to("/business/calendar"),
    },
    {
      count: quotes.data?.needsReply.length ?? 0,
      label: (n: number) => `${n} quote ${n === 1 ? "request" : "requests"} waiting for a price`,
      href: to("/business/quotes"),
    },
    {
      count: inbox.data?.problems.length ?? 0,
      label: (n: number) => `${n} ${n === 1 ? "job" : "jobs"} with a reported problem`,
      href: to("/business/calendar"),
    },
    {
      count: manager ? (inbox.data?.unassigned.length ?? 0) : 0,
      label: (n: number) => `${n} upcoming ${n === 1 ? "job needs" : "jobs need"} a crew member`,
      href: to("/business/calendar"),
    },
  ].filter((item) => item.count > 0);

  const published = Boolean(listing.data?.business.publishedAt);
  const missing = listing.data?.readiness.missing ?? [];
  return (
    <>
      <View style={styles.section}>
        <Text variant="display">{membership.business.name}</Text>
        <View style={styles.row}>
          <Badge label={ROLE_NAMES[membership.role]} size="sm" />
          {listing.data ? (
            <Badge
              label={published ? "Listed" : "Not listed yet"}
              size="sm"
              background={published ? seasons.spring.tint : seasons.summer.tint}
              textColor={published ? colors.primary : colors.ink}
            />
          ) : null}
        </View>
      </View>

      {listing.data && !published && manager ? (
        <Card style={styles.section}>
          <Text variant="heading">Finish your listing</Text>
          {missing.length > 0 ? (
            missing.map((item) => (
              <Text key={item.key} tone="muted">
                • {item.label}
              </Text>
            ))
          ) : (
            <Text tone="muted">Everything's ready. Publish it from Listing.</Text>
          )}
        </Card>
      ) : null}

      {payouts.data?.bookingsPaused ? (
        <FormAlert
          tone="error"
          message="New bookings are paused until payout setup is finished. Open Payouts to finish it."
        />
      ) : payouts.data && !payouts.data.payoutsEnabled && payouts.data.setupDueAt ? (
        <FormAlert
          tone="info"
          message="You have a paid booking. Finish payout setup so your bookings aren't cancelled."
        />
      ) : null}

      <View style={styles.section}>
        <Text variant="title">Waiting on you</Text>
        {inbox.isPending ? null : waiting.length === 0 ? (
          <Text tone="muted">Nothing right now. New requests and quotes show up here.</Text>
        ) : (
          <Card flush style={styles.card}>
            {waiting.map((item, index) => (
              <ListRow
                key={item.label(item.count)}
                label={item.label(item.count)}
                icon={icons.check}
                divider={index > 0}
                onPress={() => router.push(item.href)}
              />
            ))}
          </Card>
        )}
      </View>

      <View style={styles.section}>
        <Text variant="title">Tools</Text>
        <Card flush style={styles.card}>
          <ListRow
            label="Calendar"
            description="Jobs by day, requests and crew"
            icon={icons.bookings}
            onPress={() => router.push(to("/business/calendar"))}
          />
          <ListRow
            label="Snow route"
            description="Snow contracts in order; mark each one Cleared"
            icon={toolIcons.snow}
            divider
            onPress={() => router.push(to("/business/snow-route"))}
          />
          {manager ? (
            <ListRow
              label="Quotes"
              description="Requests from customers and your replies"
              icon={toolIcons.quotes}
              divider
              onPress={() => router.push(to("/business/quotes"))}
            />
          ) : null}
          <ListRow
            label="Listing"
            description="Profile, services, photos and service area"
            icon={toolIcons.listing}
            divider
            onPress={() => router.push(to("/business/listing"))}
          />
          <ListRow
            label="Team"
            description={manager ? "Crew, working hours and time off" : "Your hours and time off"}
            icon={toolIcons.team}
            divider
            onPress={() => router.push(to("/business/team"))}
          />
          {manager ? (
            <ListRow
              label="Payouts"
              description={
                payouts.data
                  ? payouts.data.payoutsEnabled
                    ? `Next payout: ${formatCad(payouts.data.upcomingCents)} so far`
                    : "Not set up yet"
                  : "Weekly payouts to your bank"
              }
              icon={toolIcons.payouts}
              divider
              onPress={() => router.push(to("/business/payouts"))}
            />
          ) : null}
          {published ? (
            <ListRow
              label="See your public page"
              icon={toolIcons.page}
              divider
              onPress={() =>
                router.push({
                  pathname: "/pros/[slug]",
                  params: { slug: membership.business.slug },
                })
              }
            />
          ) : null}
        </Card>
      </View>
    </>
  );
}

/** Business tools, opened from Account (SPEC §18–§20). */
export default function BusinessHubRoute() {
  const { businessId } = useLocalSearchParams<{ businessId?: string }>();
  return (
    <BusinessScreen businessId={businessId} switcher>
      {(membership) => <Hub key={membership.business.id} membership={membership} />}
    </BusinessScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: { overflow: "hidden" },
});
