import { formatCad } from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { Badge } from "@/components/badge.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { icons } from "@/components/icon.tsx";
import { PrivatePhotoGrid } from "@/components/private-photos.tsx";
import { Screen } from "@/components/screen.tsx";
import { Text } from "@/components/text.tsx";
import { IconButton, TopBar, topBarIcons } from "@/components/top-bar.tsx";
import { FormAlert } from "@/lib/auth-ui.tsx";
import { type QuoteGroup, quoteStatusColors, quoteWhen } from "@/lib/quotes.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { apiErrorMessage } from "@/lib/trpc-client.ts";
import { colors, space } from "@/theme";
import { enterUp } from "@/theme/motion.ts";

type Quote = NonNullable<QuoteGroup["pros"][number]["quote"]>;

/** The line under a quote's price: one-off, recurring offer or snow contract (SPEC §21). */
function offerDetails(quote: Quote): string {
  const withFees = `${formatCad(quote.total.totalCents)}${
    quote.kind === "one_off" ? "" : " per visit"
  } with the service fee${quote.total.taxCents > 0 ? " and HST" : ""}`;
  if (quote.kind === "recurring") {
    const often = quote.frequencies.map((option) => option.label.toLowerCase()).join(" or ");
    return `Recurring visits: ${often} · about ${quote.duration} each · ${withFees}`;
  }
  if (quote.contract) {
    const billing = quote.contract.seasonBilling
      ? ` · ${
          quote.contract.seasonBilling === "either"
            ? "pay upfront or monthly"
            : `paid ${quote.contract.seasonBilling}`
        }`
      : "";
    return `Snow contract: ${quote.contract.season} · cleared from ${quote.contract.triggerCm} cm${billing}`;
  }
  return `About ${quote.duration} · ${withFees}`;
}

/** One request: what was asked, each pro's answer, and booking a quote (SPEC §20). */
export default function QuoteGroupRoute() {
  const { groupId, new: isNew } = useLocalSearchParams<{ groupId: string; new?: string }>();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const queryOptions = trpc.quotes.get.queryOptions({ groupId: groupId ?? "" });
  // Quotes arrive while the screen is open.
  const query = useQuery({ ...queryOptions, enabled: Boolean(groupId), refetchInterval: 30_000 });
  const close = useMutation(
    trpc.quotes.close.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryOptions.queryKey });
        void queryClient.invalidateQueries({ queryKey: trpc.quotes.list.queryKey() });
      },
    }),
  );
  const back = () => (router.canGoBack() ? router.back() : router.replace("/quotes"));

  const askToClose = () =>
    Alert.alert(
      "Close this request?",
      "Pros who haven't replied are told, and their quotes close.",
      [
        { text: "Keep it open", style: "cancel" },
        {
          text: "Close request",
          style: "destructive",
          onPress: () => close.mutate({ groupId: groupId ?? "" }),
        },
      ],
    );

  return (
    <Screen
      edges={["top", "bottom", "left", "right"]}
      header={
        <TopBar leading={<IconButton icon={topBarIcons.back} label="Back" onPress={back} />} />
      }
    >
      {query.isPending ? (
        <ActivityIndicator
          color={colors.primary}
          accessibilityLabel="Loading"
          style={styles.spinner}
        />
      ) : query.isError ? (
        query.error.data?.code === "NOT_FOUND" ? (
          <EmptyState
            icon={icons.chat}
            title="We couldn't find that request"
            message="It may belong to a different account."
            action={<Button label="Your quotes" variant="secondary" onPress={back} />}
          />
        ) : (
          <View style={styles.section}>
            <FormAlert tone="error" message="We couldn't load this request right now." />
            <Button label="Try again" variant="secondary" onPress={() => query.refetch()} />
          </View>
        )
      ) : (
        <Animated.View entering={enterUp} style={styles.page}>
          {isNew ? (
            <FormAlert
              tone="success"
              message="Request sent. We'll let you know as quotes come in; pros have 3 days to reply."
            />
          ) : null}
          <View style={styles.section}>
            <Text variant="small" tone="primary">
              QUOTE REQUEST
            </Text>
            <Text variant="display">{query.data.category.name}</Text>
            <Text variant="bodyStrong" tone="muted">
              {query.data.summary}
            </Text>
          </View>

          <View style={styles.section}>
            <Text variant="title">Quotes</Text>
            {query.data.pros.map((pro) => {
              const tone = quoteStatusColors(pro.status);
              return (
                <Card key={pro.requestId} style={styles.section}>
                  <View style={styles.row}>
                    <Text variant="heading" style={styles.grow}>
                      {pro.business.name}
                    </Text>
                    <Badge
                      label={pro.statusLabel}
                      background={tone.background}
                      textColor={tone.text}
                      size="sm"
                    />
                  </View>
                  {pro.quote ? (
                    <>
                      <Text variant="display">
                        {formatCad(pro.quote.priceCents)}
                        {pro.quote.kind === "recurring" ||
                        pro.quote.contract?.pricing === "per_visit" ? (
                          <Text variant="bodyStrong" tone="muted">
                            {" "}
                            per visit
                          </Text>
                        ) : pro.quote.kind === "snow_contract" ? (
                          <Text variant="bodyStrong" tone="muted">
                            {" "}
                            for the season
                          </Text>
                        ) : null}
                      </Text>
                      <Text variant="small" tone="muted">
                        {offerDetails(pro.quote)}
                      </Text>
                      {pro.quote.note ? <Text>“{pro.quote.note}”</Text> : null}
                      {pro.canBook ? (
                        <Text variant="small" tone="muted">
                          Open until {quoteWhen.format(pro.quote.expiresAt)}
                        </Text>
                      ) : null}
                    </>
                  ) : pro.status === "open" && pro.replyBy ? (
                    <Text tone="muted">Replies by {quoteWhen.format(pro.replyBy)}.</Text>
                  ) : pro.declineReason ? (
                    <Text>Their reason: “{pro.declineReason}”</Text>
                  ) : null}
                  <View style={styles.actions}>
                    {pro.canBook && pro.quote ? (
                      <Button
                        label={
                          pro.quote.kind === "recurring"
                            ? "Pick a schedule"
                            : pro.quote.kind === "snow_contract"
                              ? "Sign up"
                              : "Book this quote"
                        }
                        size="sm"
                        onPress={() =>
                          router.push({
                            pathname:
                              pro.quote?.kind === "recurring"
                                ? "/recurring"
                                : pro.quote?.kind === "snow_contract"
                                  ? "/contract"
                                  : "/book",
                            params: { quoteId: pro.quote?.id ?? "" },
                          })
                        }
                      />
                    ) : null}
                    {pro.bookingId ? (
                      <Button
                        label="See your booking"
                        size="sm"
                        onPress={() =>
                          router.push({
                            pathname: "/bookings/[id]",
                            params: { id: pro.bookingId ?? "" },
                          })
                        }
                      />
                    ) : null}
                    {pro.conversationId ? (
                      <Button
                        label="Message"
                        size="sm"
                        variant="secondary"
                        icon={icons.chat}
                        accessibilityLabel={`Message ${pro.business.name}`}
                        onPress={() =>
                          router.push({
                            pathname: "/inbox/[conversationId]",
                            params: { conversationId: pro.conversationId ?? "" },
                          })
                        }
                      />
                    ) : null}
                    <Button
                      label="Profile"
                      size="sm"
                      variant="ghost"
                      accessibilityLabel={`See ${pro.business.name}'s profile`}
                      onPress={() =>
                        router.push({
                          pathname: "/pros/[slug]",
                          params: { slug: pro.business.slug },
                        })
                      }
                    />
                  </View>
                </Card>
              );
            })}
          </View>

          <Card style={styles.section}>
            <Text variant="heading">What you asked</Text>
            <Text>{query.data.details}</Text>
            <View style={styles.row}>
              <Text tone="muted" style={styles.grow}>
                When
              </Text>
              <Text>{query.data.timingLabel}</Text>
            </View>
            <View style={styles.row}>
              <Text tone="muted" style={styles.grow}>
                Postal code
              </Text>
              <Text>{query.data.postalCode}</Text>
            </View>
            <PrivatePhotoGrid photos={query.data.photos} size={72} />
            {close.error ? <FormAlert tone="error" message={apiErrorMessage(close.error)} /> : null}
            {query.data.canClose ? (
              <Button
                label="Close request"
                variant="ghost"
                loading={close.isPending}
                onPress={askToClose}
              />
            ) : null}
          </Card>
        </Animated.View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  spinner: { marginVertical: space.xl },
  page: { gap: space.lg },
  section: { gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  grow: { flex: 1, minWidth: 0 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
