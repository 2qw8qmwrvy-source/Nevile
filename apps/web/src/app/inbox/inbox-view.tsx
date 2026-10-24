"use client";

import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/cn.ts";
import { useTRPC } from "@/lib/trpc.ts";

type Conversation = inferRouterOutputs<AppRouter>["chat"]["conversations"][number];

const shortTime = (date: Date) => {
  const sameDay = new Date().toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(
    "en-CA",
    sameDay ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" },
  ).format(date);
};

function ConversationList({ conversations }: { conversations: Conversation[] }) {
  if (conversations.length === 0) {
    return <p className="text-[15px] text-muted">No conversations yet.</p>;
  }
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
      {conversations.map((conversation) => (
        <li key={conversation.id}>
          <Link
            href={`/inbox/${conversation.id}` as Route}
            className="flex min-h-16 items-start gap-3 px-4 py-3 text-ink no-underline hover:bg-ground"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span
                  className={cn(
                    "truncate text-[16px]",
                    conversation.unread > 0 ? "font-bold" : "font-semibold",
                  )}
                >
                  {conversation.with}
                </span>
                {conversation.lastMessageAt ? (
                  <span className="flex-none text-xs text-muted">
                    {shortTime(conversation.lastMessageAt)}
                  </span>
                ) : null}
              </span>
              <span className="block truncate text-sm text-muted">{conversation.topic}</span>
              <span
                className={cn(
                  "block truncate text-sm",
                  conversation.unread > 0 ? "text-ink" : "text-muted",
                )}
              >
                {conversation.mineLast ? "You: " : ""}
                {conversation.preview}
              </span>
            </span>
            {conversation.unread > 0 ? (
              <span className="mt-1 grid h-6 min-w-6 place-items-center rounded-full bg-primary px-1.5 text-xs font-bold text-on-primary">
                <span className="sr-only">Unread messages: </span>
                {conversation.unread}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function BusinessConversations({ businessId, name }: { businessId: string; name: string }) {
  const trpc = useTRPC();
  const list = useQuery({
    ...trpc.chat.conversations.queryOptions({ businessId }),
    refetchInterval: 20_000,
  });
  return (
    <section aria-labelledby={`business-${businessId}`} className="grid gap-3">
      <h2 id={`business-${businessId}`} className="font-display text-[20px] font-bold">
        {name}
      </h2>
      {list.isPending ? (
        <Skeleton className="h-24" />
      ) : list.isError ? (
        <FormAlert tone="error">{list.error.message}</FormAlert>
      ) : (
        <ConversationList conversations={list.data} />
      )}
    </section>
  );
}

/** Your messages as a customer, each business's messages, and recent updates. */
export function InboxView({
  businesses,
}: {
  businesses: ReadonlyArray<{ id: string; name: string }>;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"messages" | "updates">("messages");
  const mine = useQuery({ ...trpc.chat.conversations.queryOptions({}), refetchInterval: 20_000 });
  const updates = useQuery({
    ...trpc.chat.notifications.queryOptions(),
    enabled: tab === "updates",
  });
  const unread = useQuery(trpc.chat.unread.queryOptions());
  const markRead = useMutation(
    trpc.chat.markNotificationsRead.mutationOptions({
      onSuccess: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.chat.notifications.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.chat.unread.queryKey() }),
        ]),
    }),
  );
  const unreadUpdates = unread.data?.notifications ?? 0;

  return (
    <div className="mt-5 grid gap-6">
      <div role="tablist" aria-label="Inbox" className="flex gap-1 border-b border-border">
        {(["messages", "updates"] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={cn(
              "-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3.5 text-[15px] font-semibold",
              tab === name
                ? "border-primary text-primary"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            {name === "messages" ? "Messages" : "Updates"}
            {name === "updates" && unreadUpdates > 0 ? (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-xs text-on-primary">
                {unreadUpdates}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "messages" ? (
        <>
          <section aria-labelledby="mine-title" className="grid gap-3">
            <h2 id="mine-title" className="font-display text-[20px] font-bold">
              {businesses.length > 0 ? "As a customer" : "Your conversations"}
            </h2>
            {mine.isPending ? (
              <Skeleton className="h-24" />
            ) : mine.isError ? (
              <FormAlert tone="error">{mine.error.message}</FormAlert>
            ) : (
              <ConversationList conversations={mine.data} />
            )}
          </section>
          {businesses.map((business) => (
            <BusinessConversations
              key={business.id}
              businessId={business.id}
              name={business.name}
            />
          ))}
        </>
      ) : (
        <section aria-label="Updates" className="grid gap-3">
          {unreadUpdates > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="justify-self-start"
              disabled={markRead.isPending}
              onClick={() => markRead.mutate()}
            >
              Mark all as read
            </Button>
          ) : null}
          {updates.isPending ? (
            <Skeleton className="h-24" />
          ) : updates.isError ? (
            <FormAlert tone="error">{updates.error.message}</FormAlert>
          ) : updates.data.length === 0 ? (
            <p className="text-[15px] text-muted">Nothing new.</p>
          ) : (
            <Card padding="none" as="section">
              <ul className="divide-y divide-border">
                {updates.data.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.path as Route}
                      className="flex min-h-14 items-center gap-3 px-4 py-3 text-ink no-underline hover:bg-ground"
                    >
                      {item.read ? null : (
                        <>
                          <span
                            className="size-2 flex-none rounded-full bg-primary"
                            aria-hidden="true"
                          />
                          <span className="sr-only">New: </span>
                        </>
                      )}
                      <span
                        className={cn(
                          "min-w-0 flex-1 text-[15px]",
                          item.read ? "text-muted" : "font-semibold",
                        )}
                      >
                        {item.text}
                      </span>
                      <span className="flex-none text-xs text-muted">
                        {shortTime(item.createdAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}
