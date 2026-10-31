"use client";

import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { formatCad } from "@nevile/core";
import { useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useTRPC } from "@/lib/trpc.ts";

type Request = inferRouterOutputs<AppRouter>["businessQuotes"]["list"]["needsReply"][number];

export const replyByFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Halifax",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function RequestRow({ request, businessId }: { request: Request; businessId: string }) {
  return (
    <li>
      <Link
        href={`/business/quotes/${request.id}?b=${businessId}` as Route}
        className="nv-card-link block rounded-card border border-border bg-surface p-4 text-ink no-underline shadow-card"
      >
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[17px] font-semibold">
            {request.category.name} · {request.customer.firstName}
          </span>
          <span className="text-sm text-muted">{request.statusLabel}</span>
        </span>
        <span className="block text-sm text-muted">
          Near {request.area} · {request.timingLabel}
        </span>
        <span className="mt-1 line-clamp-2 block text-[15px]">{request.details}</span>
        {request.replyBy ? (
          <span className="mt-2 block text-sm font-semibold text-season-ink">
            Reply by {replyByFormat.format(request.replyBy)}
          </span>
        ) : request.quote ? (
          <span className="mt-2 block text-sm font-semibold text-primary">
            Your quote: {formatCad(request.quote.priceCents)}
          </span>
        ) : null}
      </Link>
    </li>
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
    <section aria-label={title} className="grid gap-3">
      <h2 className="font-display text-[22px] font-bold">{title}</h2>
      {requests.length === 0 ? (
        <p className="text-[15px] text-muted">{empty}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {requests.map((request) => (
            <RequestRow key={request.id} request={request} businessId={businessId} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Requests needing a reply, quotes waiting on the customer, and recently closed ones. */
export function QuoteInbox({ businessId }: { businessId: string }) {
  const trpc = useTRPC();
  const list = useQuery({
    ...trpc.businessQuotes.list.queryOptions({ businessId }),
    refetchInterval: 60_000,
  });
  if (list.isPending) return <Skeleton className="h-48" />;
  if (list.isError) return <FormAlert tone="error">{list.error.message}</FormAlert>;
  return (
    <div className="grid gap-8">
      <Section
        title="Needs a reply"
        requests={list.data.needsReply}
        businessId={businessId}
        empty="No new requests. Customers can ask you for a quote from your page and from search."
      />
      <Section title="Quote sent" requests={list.data.quoted} businessId={businessId} />
      <Section title="Closed" requests={list.data.closed} businessId={businessId} />
    </div>
  );
}
