"use client";

import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { endSentence, formatCad } from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { PrivatePhotoGrid } from "@/components/photos/private-photos.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { cn } from "@/lib/cn.ts";
import { useTRPC } from "@/lib/trpc.ts";

type Group = inferRouterOutputs<AppRouter>["quotes"]["get"];

const when = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Halifax",
  weekday: "long",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const TONES: Record<string, string> = {
  quoted: "bg-primary-soft text-primary",
  accepted: "bg-primary-soft text-primary",
  open: "bg-season-tint text-season-ink",
};

/** One request: what was asked, each pro's answer, and booking a quote (SPEC §20). */
export function QuoteGroupView({ initial, isNew }: { initial: Group; isNew: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const query = useQuery({
    ...trpc.quotes.get.queryOptions({ groupId: initial.id }),
    initialData: initial,
    // Quotes arrive while the page is open.
    refetchInterval: 30_000,
  });
  const group = query.data;
  const [confirmingClose, setConfirmingClose] = useState(false);
  const close = useMutation(
    trpc.quotes.close.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.quotes.get.queryKey({ groupId: group.id }),
        }),
    }),
  );

  return (
    <div className="grid gap-6">
      <Link
        href="/quotes"
        className="inline-flex min-h-11 items-center text-[15px] font-semibold text-primary"
      >
        ← Your quotes
      </Link>
      {isNew ? (
        <FormAlert tone="success">
          Request sent. We'll email you as quotes come in; pros have 3 days to reply.
        </FormAlert>
      ) : null}
      <div>
        <p className="text-sm font-semibold tracking-[0.06em] text-primary uppercase">
          Quote request
        </p>
        <h1 className="mt-1 font-display text-[30px] leading-[1.1] font-extrabold tracking-[-0.03em] sm:text-[36px]">
          {group.category.name}
        </h1>
        <p className="mt-1 text-[16px] font-semibold text-muted">{group.summary}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <section aria-labelledby="pros-title" className="grid gap-3">
          <h2 id="pros-title" className="font-display text-[22px] font-bold">
            Quotes
          </h2>
          {group.pros.map((pro) => (
            <Card
              key={pro.requestId}
              as="article"
              aria-label={pro.business.name}
              className="grid gap-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <Link
                  href={`/pros/${pro.business.slug}` as Route}
                  className="text-[18px] font-semibold text-ink"
                >
                  {pro.business.name}
                </Link>
                <span
                  className={cn(
                    "inline-flex h-7 items-center rounded-full px-3 text-xs font-semibold",
                    TONES[pro.status] ?? "border border-border bg-ground text-muted",
                  )}
                >
                  {pro.statusLabel}
                </span>
              </div>
              {pro.quote ? (
                <div className="grid gap-2">
                  <p className="font-display text-[28px] leading-none font-bold">
                    {formatCad(pro.quote.priceCents)}
                    {pro.quote.kind === "recurring" ||
                    pro.quote.contract?.pricing === "per_visit" ? (
                      <span className="text-[16px] font-semibold text-muted"> per visit</span>
                    ) : pro.quote.kind === "snow_contract" ? (
                      <span className="text-[16px] font-semibold text-muted"> for the season</span>
                    ) : null}
                  </p>
                  {pro.quote.kind === "one_off" ? (
                    <p className="text-sm text-muted">
                      About {pro.quote.duration} · {formatCad(pro.quote.total.totalCents)} with the
                      service fee
                      {pro.quote.total.taxCents > 0 ? " and HST" : ""}
                    </p>
                  ) : pro.quote.kind === "recurring" ? (
                    <p className="text-sm text-muted">
                      Recurring visits:{" "}
                      {pro.quote.frequencies
                        .map((option) => option.label.toLowerCase())
                        .join(" or ")}{" "}
                      · about {pro.quote.duration} each · {formatCad(pro.quote.total.totalCents)}{" "}
                      per visit with the service fee
                      {pro.quote.total.taxCents > 0 ? " and HST" : ""}
                    </p>
                  ) : pro.quote.contract ? (
                    <p className="text-sm text-muted">
                      Snow contract: {pro.quote.contract.season} · cleared from{" "}
                      {pro.quote.contract.triggerCm} cm
                      {pro.quote.contract.seasonBilling
                        ? ` · ${
                            pro.quote.contract.seasonBilling === "either"
                              ? "pay upfront or monthly"
                              : `paid ${pro.quote.contract.seasonBilling}`
                          }`
                        : ""}
                    </p>
                  ) : null}
                  {pro.quote.note ? (
                    <p className="text-[15px] whitespace-pre-line">“{pro.quote.note}”</p>
                  ) : null}
                  {pro.canBook ? (
                    <p className="text-sm text-muted">
                      Open until {when.format(pro.quote.expiresAt)}
                    </p>
                  ) : null}
                </div>
              ) : pro.status === "open" && pro.replyBy ? (
                <p className="text-[15px] text-muted">
                  Replies by {endSentence(when.format(pro.replyBy))}
                </p>
              ) : pro.declineReason ? (
                <p className="text-[15px]">Their reason: “{pro.declineReason}”</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {pro.canBook && pro.quote ? (
                  <Button href={`/quotes/${group.id}/book?quote=${pro.quote.id}` as Route}>
                    {pro.quote.kind === "recurring"
                      ? "Pick a schedule"
                      : pro.quote.kind === "snow_contract"
                        ? "Sign up"
                        : "Book this quote"}
                  </Button>
                ) : null}
                {pro.bookingId ? (
                  <Button href={`/bookings/${pro.bookingId}` as Route}>See your booking</Button>
                ) : null}
                {pro.conversationId ? (
                  <Button href={`/inbox/${pro.conversationId}` as Route} variant="secondary">
                    Message
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </section>

        <Card as="aside" aria-label="Your request" className="grid gap-3">
          <h2 className="font-display text-[20px] font-bold">What you asked</h2>
          <p className="text-[15px] whitespace-pre-line">{group.details}</p>
          <dl className="grid gap-1 text-[15px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">When</dt>
              <dd>{group.timingLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Postal code</dt>
              <dd>{group.postalCode}</dd>
            </div>
          </dl>
          <PrivatePhotoGrid photos={group.photos} size="sm" />
          {close.error ? <FormAlert tone="error">{close.error.message}</FormAlert> : null}
          {group.canClose ? (
            confirmingClose ? (
              <div className="grid gap-2 rounded-input bg-ground p-3">
                <p className="text-sm">
                  Close this request? Pros who haven't replied are told, and quotes close.
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="bg-danger hover:bg-danger"
                    disabled={close.isPending}
                    onClick={() => close.mutate({ groupId: group.id })}
                  >
                    Close request
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmingClose(false)}>
                    Keep it open
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                className="justify-self-start text-danger hover:text-danger"
                onClick={() => setConfirmingClose(true)}
              >
                Close request
              </Button>
            )
          ) : null}
        </Card>
      </div>
    </div>
  );
}
