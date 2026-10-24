"use client";

import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import {
  centsToDollarInput,
  formatCad,
  formatDurationMinutes,
  parseDollarsToCents,
  QUOTE_LIMITS,
  SERVICE_DURATION_CHOICES,
} from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { PrivatePhotoGrid } from "@/components/photos/private-photos.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Field, Input, Select, Textarea } from "@/components/ui/field.tsx";
import { useTRPC } from "@/lib/trpc.ts";
import { replyByFormat } from "../quote-inbox.tsx";

type Request = inferRouterOutputs<AppRouter>["businessQuotes"]["get"];

/** One request: what the customer asked, and the quote or decline (SPEC §20). */
export function QuoteReply({ businessId, initial }: { businessId: string; initial: Request }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const query = useQuery({
    ...trpc.businessQuotes.get.queryOptions({ businessId, requestId: initial.id }),
    initialData: initial,
  });
  const request = query.data;
  const [price, setPrice] = useState(
    request.quote ? centsToDollarInput(request.quote.priceCents) : "",
  );
  const [duration, setDuration] = useState<number>(request.quote?.durationMinutes ?? 60);
  const [note, setNote] = useState(request.quote?.note ?? "");
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.businessQuotes.get.queryKey({ businessId, requestId: request.id }),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.businessQuotes.list.queryKey({ businessId }),
      }),
    ]);
  const reply = useMutation(
    trpc.businessQuotes.reply.mutationOptions({
      onSuccess: async () => {
        setSent(true);
        await refresh();
      },
    }),
  );
  const decline = useMutation(trpc.businessQuotes.decline.mutationOptions({ onSuccess: refresh }));

  function onQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    setSent(false);
    const cents = parseDollarsToCents(price);
    if (cents === null) return setProblem("Enter the price, like 120 or 120.50.");
    reply.mutate({
      businessId,
      requestId: request.id,
      priceCents: cents,
      durationMinutes: duration,
      note,
    });
  }

  return (
    <div className="grid gap-6">
      <Link
        href={`/business/quotes?b=${businessId}` as Route}
        className="inline-flex min-h-11 items-center text-[15px] font-semibold text-primary"
      >
        ← Quote requests
      </Link>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <Card as="section" aria-labelledby="request-title" className="grid gap-3">
          <p className="text-sm font-semibold text-muted">{request.statusLabel}</p>
          <h1 id="request-title" className="font-display text-[26px] leading-tight font-bold">
            {request.category.name} for {request.customer.firstName}
          </h1>
          <p className="text-[15px] text-muted">
            Near {request.area} · {request.timingLabel}
          </p>
          <p className="text-[16px] whitespace-pre-line">{request.details}</p>
          <PrivatePhotoGrid photos={request.photos} />
          {request.replyBy ? (
            <p className="text-sm font-semibold text-season-ink">
              Reply by {replyByFormat.format(request.replyBy)}.
            </p>
          ) : null}
          {request.declineReason ? (
            <p className="text-[15px]">You declined: “{request.declineReason}”</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {request.conversationId ? (
              <Button href={`/inbox/${request.conversationId}` as Route} variant="secondary">
                Message {request.customer.firstName}
              </Button>
            ) : null}
            {request.bookingId ? (
              <Button href={`/business/calendar?b=${businessId}` as Route}>
                Booked: open the calendar
              </Button>
            ) : null}
          </div>
        </Card>

        {request.canReply ? (
          <Card as="section" aria-labelledby="quote-title" className="grid gap-4">
            <h2 id="quote-title" className="font-display text-[20px] font-bold">
              {request.quote ? "Your quote" : "Send a quote"}
            </h2>
            {request.quote ? (
              <p className="text-[15px]">
                Sent: <strong>{formatCad(request.quote.priceCents)}</strong>, about{" "}
                {request.quote.duration}. Sending a new one replaces it.
              </p>
            ) : null}
            <form method="post" noValidate onSubmit={onQuote} className="grid gap-4">
              <Field
                label="Price for the job ($)"
                hint="Before Nevile's service fee, which the customer pays."
              >
                <Input
                  inputMode="decimal"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                />
              </Field>
              <Field label="How long the job takes">
                <Select
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                >
                  {SERVICE_DURATION_CHOICES.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {formatDurationMinutes(minutes)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="What's included (optional)"
                hint={`${note.length}/${QUOTE_LIMITS.noteMaxLength}`}
              >
                <Textarea
                  rows={3}
                  maxLength={QUOTE_LIMITS.noteMaxLength}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </Field>
              {problem || reply.error ? (
                <FormAlert tone="error">{problem ?? reply.error?.message}</FormAlert>
              ) : null}
              {sent && !reply.isPending ? (
                <FormAlert tone="success">Quote sent. We've emailed the customer.</FormAlert>
              ) : null}
              <Button type="submit" disabled={reply.isPending}>
                {request.quote ? "Send new quote" : "Send quote"}
              </Button>
            </form>
            {declining ? (
              <form
                method="post"
                className="grid gap-2 rounded-input bg-ground p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  decline.mutate({ businessId, requestId: request.id, reason });
                }}
              >
                <Field label="Why can't you take it?" error={decline.error?.message}>
                  <Input
                    value={reason}
                    maxLength={QUOTE_LIMITS.declineReasonMaxLength}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" variant="secondary" disabled={decline.isPending}>
                    Decline request
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeclining(false)}>
                    Never mind
                  </Button>
                </div>
              </form>
            ) : (
              <Button
                variant="ghost"
                className="justify-self-start"
                onClick={() => setDeclining(true)}
              >
                Can't take it? Decline
              </Button>
            )}
          </Card>
        ) : request.quote ? (
          <Card as="section" aria-label="Your quote" className="grid gap-2">
            <h2 className="font-display text-[20px] font-bold">Your quote</h2>
            <p className="font-display text-[28px] font-bold">
              {formatCad(request.quote.priceCents)}
            </p>
            <p className="text-sm text-muted">About {request.quote.duration}</p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
