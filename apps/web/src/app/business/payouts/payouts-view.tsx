"use client";

import { addCalendarDays, formatCad, formatIsoDate, parseIsoDate } from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useTRPC } from "@/lib/trpc.ts";

const day = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  year: "numeric",
});
/** "2026-10-12" → "October 12, 2026" (dates, not instants). */
const dateText = (iso: string) => day.format(new Date(`${iso}T12:00:00Z`));
/** Payout periods run Monday to Sunday; the stored end is the next Monday. */
function periodText(start: string, end: string): string {
  const next = parseIsoDate(end);
  return `${dateText(start)} to ${dateText(next ? formatIsoDate(addCalendarDays(next, -1)) : end)}`;
}
const dueLabel = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Halifax",
  weekday: "long",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const PAYOUT_STATUS: Record<string, string> = {
  pending: "Sending",
  processing: "On its way",
  paid: "Paid",
  failed: "Didn't go through: we'll retry",
};

export function PayoutsView({
  businessId,
  isOwner,
  returned,
}: {
  businessId: string;
  isOwner: boolean;
  returned: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const status = useQuery(trpc.payouts.status.queryOptions({ businessId }));
  const refreshStatus = () =>
    queryClient.invalidateQueries({ queryKey: trpc.payouts.status.queryKey({ businessId }) });
  const start = useMutation(
    trpc.payouts.start.mutationOptions({ onSuccess: ({ url }) => window.location.assign(url) }),
  );
  const refresh = useMutation(trpc.payouts.refresh.mutationOptions({ onSuccess: refreshStatus }));
  // Coming back from setup: ask the provider whether payouts are ready now.
  const checked = useRef(false);
  useEffect(() => {
    if (!returned || checked.current) return;
    checked.current = true;
    refresh.mutate({ businessId });
  }, [returned, businessId, refresh]);

  if (status.isPending) return <Skeleton className="h-64" />;
  if (status.isError) return <FormAlert tone="error">{status.error.message}</FormAlert>;
  const summary = status.data;

  return (
    <div className="grid gap-6">
      <Card as="section" aria-labelledby="setup-title">
        <h2 id="setup-title" className="font-display text-[22px] font-bold">
          {summary.payoutsEnabled ? "Payouts are set up" : "Set up payouts"}
        </h2>
        {summary.payoutsEnabled ? (
          <p className="mt-1 text-[15px] text-muted">
            We send what you've earned every Monday for jobs confirmed the week before. Banks
            usually take 1 to 2 business days.
          </p>
        ) : (
          <>
            <p className="mt-1 text-[15px] text-muted">
              Our payment partner, Stripe, checks your identity and bank account so we can pay you.
              It takes about 5 minutes.
            </p>
            {summary.bookingsPaused ? (
              <FormAlert tone="error" className="mt-3">
                New bookings are paused until payout setup is finished.
              </FormAlert>
            ) : summary.setupDueAt ? (
              <FormAlert tone="info" className="mt-3">
                Finish by {dueLabel.format(summary.setupDueAt)} to keep taking bookings. After that,
                upcoming bookings are cancelled and refunded.
              </FormAlert>
            ) : null}
            {returned && refresh.isPending ? (
              <p role="status" className="mt-3 text-sm text-muted">
                Checking your setup…
              </p>
            ) : returned && refresh.data && !refresh.data.payoutsEnabled ? (
              <FormAlert tone="info" className="mt-3">
                Stripe is still checking your details, or something is missing. Continue setup to
                see what's left.
              </FormAlert>
            ) : null}
            {start.error ? (
              <FormAlert tone="error" className="mt-3">
                {start.error.message}
              </FormAlert>
            ) : null}
            <div className="mt-4">
              {isOwner ? (
                <Button disabled={start.isPending} onClick={() => start.mutate({ businessId })}>
                  {summary.hasAccount ? "Continue payout setup" : "Set up payouts"}
                </Button>
              ) : (
                <p className="text-sm">Only the owner can set up payouts.</p>
              )}
            </div>
          </>
        )}
      </Card>

      <Card as="section" aria-labelledby="history-title">
        <h2 id="history-title" className="font-display text-[22px] font-bold">
          Earnings
        </h2>
        <p className="mt-1 text-[15px] text-muted">
          Waiting to be paid out:{" "}
          <strong className="text-ink">{formatCad(summary.upcomingCents)}</strong> (your price plus
          HST, less Nevile's 3% fee, before any refunds).
        </p>
        {summary.payouts.length === 0 ? (
          <p className="mt-4 text-[15px] text-muted">No payouts yet.</p>
        ) : (
          <table className="mt-4 w-full text-left text-[15px]">
            <caption className="sr-only">Recent payouts</caption>
            <thead className="text-sm text-muted">
              <tr>
                <th scope="col" className="py-2 font-semibold">
                  Week
                </th>
                <th scope="col" className="py-2 font-semibold">
                  Amount
                </th>
                <th scope="col" className="py-2 font-semibold">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.payouts.map((payout) => (
                <tr key={payout.id} className="border-t border-border">
                  <td className="py-2.5">{periodText(payout.periodStart, payout.periodEnd)}</td>
                  <td className="py-2.5 tabular-nums">{formatCad(payout.amountCents)}</td>
                  <td className="py-2.5">{PAYOUT_STATUS[payout.status] ?? payout.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
