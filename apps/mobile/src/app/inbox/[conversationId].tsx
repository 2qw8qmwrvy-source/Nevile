import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { MESSAGE_LIMITS } from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, TextInput, View } from "react-native";

import { Button } from "@/components/button.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { icons } from "@/components/icon.tsx";
import { PhotoPicker, PrivatePhotoGrid, photoState } from "@/components/private-photos.tsx";
import { Screen } from "@/components/screen.tsx";
import { Text } from "@/components/text.tsx";
import { IconButton, TopBar, topBarIcons } from "@/components/top-bar.tsx";
import { openPath } from "@/lib/app-links.ts";
import { FormAlert } from "@/lib/auth-ui.tsx";
import { useMe } from "@/lib/me.ts";
import type { PickedPhoto } from "@/lib/photos.ts";
import { askForPush } from "@/lib/push.ts";
import { useTRPC, useTRPCClient } from "@/lib/trpc.tsx";
import { apiErrorMessage } from "@/lib/trpc-client.ts";
import { colors, radius, space, typography } from "@/theme";

type Thread = inferRouterOutputs<AppRouter>["chat"]["thread"];
type Message = Thread["messages"][number];

/** Polls for new messages every few seconds while open (SPEC §20 default). */
const POLL_MS = 4000;

const time = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function contextLink(conversation: Thread["conversation"]): { path: string; label: string } | null {
  if (conversation.side === "customer") {
    if (conversation.bookingId) {
      return { path: `/bookings/${conversation.bookingId}`, label: "See the booking" };
    }
    if (conversation.quoteGroupId) {
      return { path: `/quotes/${conversation.quoteGroupId}`, label: "See the quotes" };
    }
    return null;
  }
  if (conversation.bookingId) {
    return { path: `/business/calendar?b=${conversation.businessId}`, label: "Open the calendar" };
  }
  if (conversation.quoteRequestId) {
    return {
      path: `/business/quotes/${conversation.quoteRequestId}?b=${conversation.businessId}`,
      label: "See the request",
    };
  }
  return null;
}

/** One conversation: messages (polled while open) and a composer with photos. */
export default function ConversationRoute() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const { me } = useMe();
  const list = useRef<FlatList<Message>>(null);
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [later, setLater] = useState<Message[]>([]);

  const thread = useQuery({
    ...trpc.chat.thread.queryOptions({ conversationId: conversationId ?? "" }),
    enabled: Boolean(conversationId),
    staleTime: 0,
  });
  const messages = useMemo(() => {
    const all = [...(thread.data?.messages ?? []), ...later];
    const seen = new Set<string>();
    return all.filter((message) => {
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    });
  }, [thread.data, later]);
  const last = messages.at(-1)?.createdAt ?? null;

  const fresh = useQuery({
    ...trpc.chat.since.queryOptions({ conversationId: conversationId ?? "", after: last }),
    enabled: thread.isSuccess,
    refetchInterval: POLL_MS,
  });
  useEffect(() => {
    const incoming = fresh.data ?? [];
    if (incoming.length === 0) return;
    setLater((current) => [...current, ...incoming]);
    void queryClient.invalidateQueries({ queryKey: trpc.chat.unread.queryKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.chat.conversations.queryKey() });
  }, [fresh.data, queryClient, trpc]);

  const send = useMutation(
    trpc.chat.send.mutationOptions({
      onSuccess: async () => {
        setBody("");
        setPhotos([]);
        void askForPush(client);
        await fresh.refetch();
      },
    }),
  );
  const uploads = photoState(photos);
  const canSend =
    !send.isPending && !uploads.uploading && (body.trim().length > 0 || uploads.ids.length > 0);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/inbox"));

  const conversation = thread.data?.conversation;
  const context = conversation ? contextLink(conversation) : null;
  const locked = me.data?.verified === false;

  return (
    <Screen
      scroll={false}
      avoidKeyboard
      edges={["top", "bottom", "left", "right"]}
      contentStyle={styles.content}
      header={
        <View style={styles.header}>
          <TopBar leading={<IconButton icon={topBarIcons.back} label="Inbox" onPress={back} />} />
          {conversation ? (
            <View style={styles.title}>
              <Text variant="title" numberOfLines={1}>
                {conversation.with}
              </Text>
              <Text variant="small" tone="muted" numberOfLines={1}>
                {conversation.topic}
              </Text>
              {context ? (
                <Button
                  label={context.label}
                  variant="ghost"
                  size="sm"
                  onPress={() => openPath(context.path)}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      }
      footer={
        conversation ? (
          <View style={styles.composer}>
            {conversation.contactShared ? null : (
              <Text variant="small" tone="muted" style={styles.center}>
                Phone numbers and emails stay hidden until a booking is paid. Keep payments on
                Nevile.
              </Text>
            )}
            {send.error ? <FormAlert tone="error" message={apiErrorMessage(send.error)} /> : null}
            {locked ? (
              <FormAlert
                tone="info"
                message="Confirm your email address or phone number to send messages."
              />
            ) : (
              <>
                <PhotoPicker
                  purpose="chat"
                  photos={photos}
                  setPhotos={setPhotos}
                  max={MESSAGE_LIMITS.maxPhotos}
                />
                <View style={styles.inputRow}>
                  <TextInput
                    accessibilityLabel="Message"
                    placeholder="Write a message"
                    placeholderTextColor={colors.placeholder}
                    value={body}
                    onChangeText={setBody}
                    multiline
                    maxLength={MESSAGE_LIMITS.maxLength}
                    style={styles.input}
                  />
                  <Button
                    label="Send"
                    loading={send.isPending}
                    disabled={!canSend}
                    onPress={() =>
                      send.mutate({
                        conversationId: conversation.id,
                        body,
                        photoIds: uploads.ids,
                      })
                    }
                  />
                </View>
              </>
            )}
          </View>
        ) : null
      }
    >
      {thread.isPending ? (
        <ActivityIndicator
          color={colors.primary}
          accessibilityLabel="Loading"
          style={styles.spinner}
        />
      ) : thread.isError ? (
        thread.error.data?.code === "NOT_FOUND" ? (
          <EmptyState
            icon={icons.chat}
            title="We couldn't find that conversation"
            message="It may belong to a different account."
            action={<Button label="Inbox" variant="secondary" onPress={back} />}
          />
        ) : (
          <View style={styles.error}>
            <FormAlert tone="error" message="We couldn't load this conversation right now." />
            <Button label="Try again" variant="secondary" onPress={() => thread.refetch()} />
          </View>
        )
      ) : (
        <FlatList
          ref={list}
          data={messages}
          keyExtractor={(message) => message.id}
          accessibilityLabel="Messages"
          contentContainerStyle={styles.messages}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <Text tone="muted" style={styles.center}>
              No messages yet. Say hello.
            </Text>
          }
          renderItem={({ item }) => (
            <View
              style={[styles.bubbleRow, item.mine ? styles.mineRow : styles.theirsRow]}
              accessible
              accessibilityLabel={`${item.mine ? "You" : (conversation?.with ?? "")}: ${item.body || "Photo"}, ${time.format(item.createdAt)}`}
            >
              <View style={[styles.bubble, item.mine ? styles.mine : styles.theirs]}>
                {item.body ? <Text tone={item.mine ? "onPrimary" : "ink"}>{item.body}</Text> : null}
                <PrivatePhotoGrid photos={item.photos} size={120} />
                <Text variant="small" tone={item.mine ? "onPrimary" : "muted"} style={styles.time}>
                  {time.format(item.createdAt)}
                </Text>
              </View>
            </View>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 },
  spinner: { marginVertical: space.xl },
  error: { gap: 10, padding: 20 },
  header: { borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { paddingHorizontal: 20, paddingBottom: 8, alignItems: "flex-start" },
  messages: { gap: 10, paddingHorizontal: 16, paddingVertical: space.md, flexGrow: 1 },
  bubbleRow: { flexDirection: "row" },
  mineRow: { justifyContent: "flex-end" },
  theirsRow: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "85%",
    gap: 6,
    borderRadius: radius.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  mine: { backgroundColor: colors.primary },
  theirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  time: { alignSelf: "flex-end", opacity: 0.85 },
  center: { textAlign: "center" },
  composer: {
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: {
    ...typography.body,
    flex: 1,
    minHeight: 48,
    maxHeight: 140,
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 13,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.ground,
    color: colors.ink,
  },
});
