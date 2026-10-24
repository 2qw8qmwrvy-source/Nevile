import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Chip } from "@/components/chip.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { icons } from "@/components/icon.tsx";
import { PressableScale } from "@/components/pressable-scale.tsx";
import { Screen } from "@/components/screen.tsx";
import { Text } from "@/components/text.tsx";
import { openPath } from "@/lib/app-links.ts";
import { FormAlert } from "@/lib/auth-ui.tsx";
import { useMe } from "@/lib/me.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { colors, seasons, space } from "@/theme";

type Conversation = inferRouterOutputs<AppRouter>["chat"]["conversations"][number];

/** Roles that see a business's conversations (SPEC §20: owners and managers). */
const CHAT_ROLES: ReadonlySet<string> = new Set(["owner", "manager"]);

const clockTime = new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" });
const dayMonth = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" });

/** The time for today's messages, the date for older ones. */
function shortTime(date: Date): string {
  const today = new Date().toDateString() === date.toDateString();
  return (today ? clockTime : dayMonth).format(date);
}

function ConversationRow({
  conversation,
  divider,
}: {
  conversation: Conversation;
  divider: boolean;
}) {
  const unread = conversation.unread > 0;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${conversation.with}, ${conversation.topic}. ${unread ? `${conversation.unread} unread. ` : ""}${conversation.mineLast ? "You: " : ""}${conversation.preview}`}
      pressedScale={0.99}
      onPress={() =>
        router.push({
          pathname: "/inbox/[conversationId]",
          params: { conversationId: conversation.id },
        })
      }
      style={[styles.row, divider && styles.divider]}
    >
      <View style={styles.grow}>
        <View style={styles.rowTop}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.grow}>
            {conversation.with}
          </Text>
          {conversation.lastMessageAt ? (
            <Text variant="small" tone="muted">
              {shortTime(conversation.lastMessageAt)}
            </Text>
          ) : null}
        </View>
        <Text variant="small" tone="muted" numberOfLines={1}>
          {conversation.topic}
        </Text>
        <Text
          variant={unread ? "bodyStrong" : "body"}
          numberOfLines={1}
          tone={unread ? "ink" : "muted"}
        >
          {conversation.mineLast ? "You: " : ""}
          {conversation.preview}
        </Text>
      </View>
      {unread ? (
        <View style={styles.count}>
          <Text variant="small" tone="onPrimary">
            {conversation.unread > 99 ? "99+" : conversation.unread}
          </Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

function ConversationList({
  conversations,
  empty,
}: {
  conversations: Conversation[];
  empty: string;
}) {
  if (conversations.length === 0) return <Text tone="muted">{empty}</Text>;
  return (
    <Card flush style={styles.card}>
      {conversations.map((conversation, index) => (
        <ConversationRow key={conversation.id} conversation={conversation} divider={index > 0} />
      ))}
    </Card>
  );
}

function BusinessConversations({ businessId, name }: { businessId: string; name: string }) {
  const trpc = useTRPC();
  const list = useQuery({
    ...trpc.chat.conversations.queryOptions({ businessId }),
    refetchInterval: 20_000,
  });
  return (
    <View style={styles.section}>
      <Text variant="title">{name}</Text>
      {list.isPending ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />
      ) : list.isError ? (
        <FormAlert tone="error" message="We couldn't load these conversations." />
      ) : (
        <ConversationList conversations={list.data} empty="No customer conversations yet." />
      )}
    </View>
  );
}

/** Conversations with pros (and customers, for owners and managers) plus updates (SPEC §20). */
export default function InboxScreen() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { user, me } = useMe();
  const signedIn = user !== null;
  const [tab, setTab] = useState<"messages" | "updates">("messages");
  const mine = useQuery({
    ...trpc.chat.conversations.queryOptions({}),
    enabled: signedIn,
    refetchInterval: 20_000,
  });
  const updates = useQuery({
    ...trpc.chat.notifications.queryOptions(),
    enabled: signedIn && tab === "updates",
  });
  const unread = useQuery({ ...trpc.chat.unread.queryOptions(), enabled: signedIn });
  const markRead = useMutation(
    trpc.chat.markNotificationsRead.mutationOptions({
      onSuccess: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.chat.notifications.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.chat.unread.queryKey() }),
        ]),
    }),
  );
  const refetchMine = mine.refetch;
  const refetchUnread = unread.refetch;
  useFocusEffect(
    useCallback(() => {
      if (!signedIn) return;
      void refetchMine();
      void refetchUnread();
    }, [signedIn, refetchMine, refetchUnread]),
  );

  if (!signedIn) {
    return (
      <Screen title="Inbox">
        <EmptyState
          icon={icons.chat}
          tint={seasons.winter.tint}
          iconColor={seasons.winter.accent}
          title="Sign in to see your messages"
          message="Chat with pros about quotes and bookings. Phone numbers and emails are shared once a booking is paid."
          action={<Button label="Sign in" onPress={() => router.push("/sign-in")} />}
        />
      </Screen>
    );
  }

  const businesses = (me.data?.businesses ?? []).filter((membership) =>
    CHAT_ROLES.has(membership.role),
  );
  const unreadUpdates = unread.data?.notifications ?? 0;
  return (
    <Screen title="Inbox">
      <View style={styles.tabs} accessibilityRole="tablist">
        <Chip
          label="Messages"
          selected={tab === "messages"}
          accessibilityRole="tab"
          onPress={() => setTab("messages")}
        />
        <Chip
          label={unreadUpdates > 0 ? `Updates (${unreadUpdates})` : "Updates"}
          selected={tab === "updates"}
          accessibilityRole="tab"
          onPress={() => setTab("updates")}
        />
      </View>

      {tab === "messages" ? (
        <View style={styles.page}>
          <View style={styles.section}>
            {businesses.length > 0 ? <Text variant="title">As a customer</Text> : null}
            {mine.isPending ? (
              <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />
            ) : mine.isError ? (
              <FormAlert tone="error" message="We couldn't load your messages right now." />
            ) : mine.data.length === 0 && businesses.length === 0 ? (
              <EmptyState
                icon={icons.chat}
                tint={seasons.winter.tint}
                iconColor={seasons.winter.accent}
                title="No messages yet"
                message="Chat opens when you ask for a quote or book. Phone numbers and emails are shared once a booking is paid."
                action={
                  <Button
                    label="Browse services"
                    variant="secondary"
                    onPress={() => router.navigate("/search")}
                  />
                }
              />
            ) : (
              <ConversationList conversations={mine.data} empty="No conversations yet." />
            )}
          </View>
          {businesses.map((membership) => (
            <BusinessConversations
              key={membership.business.id}
              businessId={membership.business.id}
              name={membership.business.name}
            />
          ))}
        </View>
      ) : (
        <View style={styles.section}>
          {unreadUpdates > 0 ? (
            <Button
              label="Mark all as read"
              variant="ghost"
              size="sm"
              loading={markRead.isPending}
              onPress={() => markRead.mutate()}
            />
          ) : null}
          {updates.isPending ? (
            <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />
          ) : updates.isError ? (
            <FormAlert tone="error" message="We couldn't load your updates right now." />
          ) : updates.data.length === 0 ? (
            <Text tone="muted">Nothing new.</Text>
          ) : (
            <Card flush style={styles.card}>
              {updates.data.map((item, index) => (
                <PressableScale
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.read ? "" : "New: "}${item.text}`}
                  pressedScale={0.99}
                  onPress={() => openPath(item.path)}
                  style={[styles.row, index > 0 && styles.divider]}
                >
                  {item.read ? null : <View style={styles.dot} />}
                  <Text
                    variant={item.read ? "body" : "bodyStrong"}
                    tone={item.read ? "muted" : "ink"}
                    style={styles.grow}
                  >
                    {item.text}
                  </Text>
                  <Text variant="small" tone="muted">
                    {shortTime(item.createdAt)}
                  </Text>
                </PressableScale>
              ))}
            </Card>
          )}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", gap: 8, marginBottom: space.md },
  page: { gap: space.lg },
  section: { gap: 10 },
  card: { overflow: "hidden" },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  count: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
});
