import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { formatCad } from "@nevile/core";
import { useQuery } from "@tanstack/react-query";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { BusinessScreen } from "@/components/business-screen.tsx";
import { Card } from "@/components/card.tsx";
import { Icon, icons } from "@/components/icon.tsx";
import { PressableScale } from "@/components/pressable-scale.tsx";
import { Text } from "@/components/text.tsx";
import { FormAlert } from "@/lib/auth-ui.tsx";
import type { Membership } from "@/lib/business.ts";
import { replyByFormat } from "@/lib/quotes.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { apiErrorMessage } from "@/lib/trpc-client.ts";
import { colors } from "@/theme";

type Request = inferRouterOutputs<AppRouter>["businessQuotes"]["get"];

function RequestRow({ request, businessId }: { request: Request; businessId: string }) {
  const detail = request.quote
    ? `Quoted ${formatCad(request.quote.priceCents)}`
    : request.replyBy
      ? `Reply by ${replyByFormat.format(request.replyBy)}`
      : request.statusLabel;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${request.category.name} · ${request.customer.firstName}, near ${request.area}. ${detail}`}
      pressedScale={0.98}
      onPress={() =>
        router.push({
          pathname: "/business/quotes/[requestId]",
          params: { requestId: request.id, businessId },
        })
      }
      style={styles.row}
    >
      <View style={styles.body}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {request.category.name} · {request.customer.firstName}
        </Text>
        <Text variant="small" tone="muted" numberOfLines={1}>
          Near {request.area} · {request.timingLabel}
        </Text>
        <Text variant="small" tone={request.replyBy ? "primary" : "muted"}>
          {detail}
        </Text>
      </View>
      <Icon name={icons.chevronRight} size={16} color={colors.muted} />
    </PressableScale>
  );
}

function Section({
  title,
  requests,
  businessId,
  empty,
}: {
  title: string;
  requests: Request[];
  businessId: string;
  empty?: string;
}) {
  if (requests.length === 0 && !empty) return null;
  return (
    <View style={styles.section}>
      <Text variant="title">{title}</Text>
      {requests.length === 0 ? (
        <Text tone="muted">{empty}</Text>
      ) : (
        requests.map((request) => (
          <RequestRow key={request.id} request={request} businessId={businessId} />
        ))
      )}
    </View>
  );
}

function Quotes({ membership }: { membership: Membership }) {
  const trpc = useTRPC();
  const businessId = membership.business.id;
  const list = useQuery(trpc.businessQuotes.list.queryOptions({ businessId }));
  const refetch = list.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  return (
    <>
      <Text variant="display">Quote requests</Text>
      <Text tone="muted">
        Customers nearby ask for a price. Reply within 3 days with one price; you can revise it
        until they book.
      </Text>
      {list.isPending ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />
      ) : list.isError ? (
        <FormAlert tone="error" message={apiErrorMessage(list.error)} />
      ) : (
        <>
          <Section
            title="Needs a reply"
            requests={list.data.needsReply}
            businessId={businessId}
            empty="Nothing waiting. New requests show up here and in your Inbox."
          />
          <Section title="Quoted" requests={list.data.quoted} businessId={businessId} />
          <Card style={styles.section}>
            <Text variant="heading">Recently closed</Text>
            {list.data.closed.length === 0 ? (
              <Text tone="muted">None in the last 30 days.</Text>
            ) : (
              list.data.closed.map((request) => (
                <RequestRow key={request.id} request={request} businessId={businessId} />
              ))
            )}
          </Card>
        </>
      )}
    </>
  );
}

/** Quote requests for owners and managers (SPEC §20). */
export default function BusinessQuotesRoute() {
  const { businessId } = useLocalSearchParams<{ businessId?: string }>();
  return (
    <BusinessScreen businessId={businessId} managed>
      {(membership) => <Quotes key={membership.business.id} membership={membership} />}
    </BusinessScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
});
