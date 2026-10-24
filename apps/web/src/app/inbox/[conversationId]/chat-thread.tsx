"use client";

import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { MESSAGE_LIMITS } from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import {
  PrivatePhotoGrid,
  PrivatePhotoPicker,
  type UploadedPhoto,
} from "@/components/photos/private-photos.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/field.tsx";
import { cn } from "@/lib/cn.ts";
import { useTRPC } from "@/lib/trpc.ts";

type Thread = inferRouterOutputs<AppRouter>["chat"]["thread"];
type Message = Thread["messages"][number];

const time = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Polls for new messages every few seconds while open (SPEC §20 default). */
const POLL_MS = 4000;

export function ChatThread({ initial, canSend }: { initial: Thread; canSend: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { conversation } = initial;
  const [messages, setMessages] = useState<Message[]>(initial.messages);
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const last = messages.at(-1)?.createdAt ?? null;
  const bottom = useRef<HTMLDivElement>(null);

  const fresh = useQuery({
    ...trpc.chat.since.queryOptions({ conversationId: conversation.id, after: last }),
    refetchInterval: POLL_MS,
  });
  useEffect(() => {
    const incoming = fresh.data ?? [];
    if (incoming.length === 0) return;
    setMessages((current) => {
      const known = new Set(current.map((message) => message.id));
      const added = incoming.filter((message) => !known.has(message.id));
      return added.length > 0 ? [...current, ...added] : current;
    });
    void queryClient.invalidateQueries({ queryKey: trpc.chat.unread.queryKey() });
  }, [fresh.data, queryClient, trpc]);
  const count = messages.length;
  useEffect(() => {
    if (count > 0) bottom.current?.scrollIntoView({ block: "end" });
  }, [count]);

  const send = useMutation(
    trpc.chat.send.mutationOptions({
      onSuccess: async () => {
        setBody("");
        setPhotos([]);
        await fresh.refetch();
      },
    }),
  );

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim() && photos.length === 0) return;
    send.mutate({
      conversationId: conversation.id,
      body,
      photoIds: photos.map((photo) => photo.id),
    });
  }

  const context =
    conversation.side === "customer"
      ? conversation.bookingId
        ? { href: `/bookings/${conversation.bookingId}`, label: "See the booking" }
        : conversation.quoteGroupId
          ? { href: `/quotes/${conversation.quoteGroupId}`, label: "See the quotes" }
          : null
      : conversation.bookingId
        ? { href: `/business/calendar?b=${conversation.businessId}`, label: "Open the calendar" }
        : conversation.quoteRequestId
          ? {
              href: `/business/quotes/${conversation.quoteRequestId}?b=${conversation.businessId}`,
              label: "See the request",
            }
          : null;

  return (
    <div className="flex min-h-[calc(100dvh-9rem)] flex-col">
      <header className="sticky top-16 z-10 -mx-4 border-b border-border bg-ground/95 px-4 py-3 backdrop-blur">
        <Link href="/inbox" className="text-sm font-semibold text-primary">
          ← Inbox
        </Link>
        <h1 className="mt-1 font-display text-[22px] leading-tight font-bold">
          {conversation.with}
        </h1>
        <p className="text-sm text-muted">
          {conversation.topic}
          {context ? (
            <>
              {" · "}
              <Link href={context.href as Route} className="font-semibold text-primary">
                {context.label}
              </Link>
            </>
          ) : null}
        </p>
      </header>

      <ol aria-label="Messages" aria-live="polite" className="flex flex-1 flex-col gap-3 py-4">
        {messages.length === 0 ? (
          <li className="text-center text-[15px] text-muted">No messages yet. Say hello.</li>
        ) : (
          messages.map((message) => (
            <li
              key={message.id}
              className={cn("flex", message.mine ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-card px-3.5 py-2.5 sm:max-w-[70%]",
                  message.mine ? "bg-primary text-on-primary" : "border border-border bg-surface",
                )}
              >
                <span className="sr-only">{message.mine ? "You" : conversation.with}: </span>
                {message.body ? (
                  <p className="text-[15px] break-words whitespace-pre-line">{message.body}</p>
                ) : null}
                {message.photos.length > 0 ? (
                  <div className={message.body ? "mt-2" : ""}>
                    <PrivatePhotoGrid photos={message.photos} size="sm" />
                  </div>
                ) : null}
                <p
                  className={cn(
                    "mt-1 text-right text-xs",
                    message.mine ? "text-on-primary/80" : "text-muted",
                  )}
                >
                  {time.format(message.createdAt)}
                </p>
              </div>
            </li>
          ))
        )}
      </ol>
      <div ref={bottom} />

      {conversation.contactShared ? null : (
        <p className="mb-2 text-center text-xs text-muted">
          Phone numbers and emails stay hidden until a booking is paid. Keep payments on Nevile.
        </p>
      )}
      {canSend ? (
        <form
          method="post"
          onSubmit={onSubmit}
          className="sticky bottom-0 -mx-4 grid gap-2 border-t border-border bg-ground px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          {send.error ? <FormAlert tone="error">{send.error.message}</FormAlert> : null}
          <label htmlFor="message" className="sr-only">
            Message
          </label>
          <Textarea
            id="message"
            rows={2}
            maxLength={MESSAGE_LIMITS.maxLength}
            placeholder="Write a message"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="flex flex-wrap items-start justify-between gap-2">
            <PrivatePhotoPicker
              purpose="chat"
              photos={photos}
              onChange={setPhotos}
              max={MESSAGE_LIMITS.maxPhotos}
              label="Add photos"
              compact
            />
            <Button
              type="submit"
              disabled={send.isPending || (!body.trim() && photos.length === 0)}
            >
              Send
            </Button>
          </div>
        </form>
      ) : (
        <FormAlert tone="info">
          Confirm your email address or phone number to send messages.
        </FormAlert>
      )}
    </div>
  );
}
