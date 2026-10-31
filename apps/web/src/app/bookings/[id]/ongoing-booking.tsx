"use client";

import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { formatCad } from "@nevile/core";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Field, Textarea } from "@/components/ui/field.tsx";
import { useTRPC } from "@/lib/trpc.ts";
import { StatusPill } from "../status-pill.tsx";

type Booking = inferRouterOutputs<AppRouter>["bookings"]["get"];
type Ongoing = NonNullable<Booking["ongoing"]>;
type Visit = Ongoing["visits"][number];

const shortDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Halifax",
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** Where a visit's money stands, in a few words. */
function visitMoney(visit: Visit, ongoing: Ongoing): string | null {
  const { charge } = visit;
  switch (charge.state) {
    case "scheduled":
      return charge.dueAt ? `Charged ${shortDay.format(charge.dueAt)}` : null;
    case "charging":
      return "Payment going through";
    case "charged":
      return `Paid ${formatCad(charge.amountCents)}`;
    case "partly_refunded":
      return `Paid ${formatCad(charge.amountCents)} · ${formatCad(charge.refundedCents)} refunded`;
    case "refunded":
      return `Refunded ${formatCad(charge.refundedCents)}`;
    case "failed":
      return "Card declined: we'll try again";
    default:
      return ongoing.kind === "snow_contract" &&
        ongoing.pricing === "per_visit" &&
        visit.status === "completed_pending_confirmation"
        ? "Charged once you confirm"
        : null;
  }
}

/** One visit with what the customer can do to it now. */
function VisitRow({ booking, visit }: { booking: Booking; visit: Visit }) {
  const trpc = useTRPC();
  const router = useRouter();
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const done = () => router.refresh();
  const skip = useMutation(trpc.recurring.skipVisit.mutationOptions({ onSuccess: done }));
  const confirm = useMutation(trpc.bookings.confirmDone.mutationOptions({ onSuccess: done }));
  const report = useMutation(trpc.bookings.reportProblem.mutationOptions({ onSuccess: done }));
  const error = skip.error ?? confirm.error ?? report.error;
  const ongoing = booking.ongoing as Ongoing;
  const actions = "skip" in visit.actions ? visit.actions : null;
  const money = visitMoney(visit, ongoing);
  const ids = { bookingId: booking.id, visitId: visit.id };

  return (
    <li className="grid gap-2 border-t border-border py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[16px] font-semibold">{visit.window.label}</p>
          {money ? <p className="text-sm text-muted">{money}</p> : null}
        </div>
        <StatusPill status={visit.status} label={visit.statusLabel} />
      </div>
      {visit.photos.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {visit.photos.map((photo) => (
            <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer">
              {/* biome-ignore lint/performance/noImgElement: private, streamed with the session. */}
              <img
                src={photo.url}
                alt="The cleared driveway, taken by the pro"
                className="size-24 rounded-input border border-border object-cover"
              />
            </a>
          ))}
        </div>
      ) : null}
      {error ? (
        <FormAlert tone="error">
          {error.data?.zodError?.fieldErrors?.reason?.[0] ?? error.message}
        </FormAlert>
      ) : null}
      {actions?.confirmDone ? (
        <div className="flex flex-wrap gap-3">
          <Button size="sm" onClick={() => confirm.mutate(ids)} disabled={confirm.isPending}>
            Yes, it's done
          </Button>
          {actions.reportProblem && !reporting ? (
            <Button size="sm" variant="secondary" onClick={() => setReporting(true)}>
              Report a problem
            </Button>
          ) : null}
        </div>
      ) : null}
      {reporting ? (
        <form
          method="post"
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            report.mutate({ ...ids, reason });
          }}
        >
          <Field label="What's wrong?" hint="The pro gets 3 days to put it right.">
            <Textarea
              rows={3}
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div className="flex gap-3">
            <Button type="submit" size="sm" disabled={report.isPending}>
              Send to the pro
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReporting(false)}>
              Never mind
            </Button>
          </div>
        </form>
      ) : null}
      {actions?.skip ? (
        confirmingSkip ? (
          <div className="nv-pop-in grid gap-3 rounded-input border border-border bg-ground p-3.5">
            <p className="text-[15px]">{visit.skip?.text}</p>
            <div className="flex flex-wrap gap-3">
              <Button size="sm" onClick={() => skip.mutate(ids)} disabled={skip.isPending}>
                {skip.isPending ? "Skipping…" : "Skip this visit"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmingSkip(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button size="sm" variant="secondary" onClick={() => setConfirmingSkip(true)}>
              Skip
            </Button>
          </div>
        )
      ) : null}
    </li>
  );
}

const MONTH_STATE: Record<string, string> = {
  charging: "Payment going through",
  charged: "Paid",
  cancelled: "Not charged",
  failed: "Card declined: we'll try again",
};

/** A recurring series or snow contract: schedule or terms, visits, months, and ending it. */
export function OngoingBooking({ booking }: { booking: Booking }) {
  const trpc = useTRPC();
  const router = useRouter();
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const end = useMutation(
    trpc.bookings.cancel.mutationOptions({ onSuccess: () => router.refresh() }),
  );
  const ongoing = booking.ongoing;
  if (!ongoing) return null;
  const snow = ongoing.kind === "snow_contract";
  const thing = snow ? "contract" : "series";
  const requested = booking.status === "requested";

  return (
    <>
      {ongoing.paused ? (
        <FormAlert tone="error">
          {ongoing.paused.text}{" "}
          <a
            href={`/account/card?next=${encodeURIComponent(`/bookings/${booking.id}`)}`}
            className="font-semibold underline"
          >
            Update your card
          </a>
        </FormAlert>
      ) : null}

      {ongoing.kind === "recurring" ? (
        <Card as="section" aria-labelledby="schedule-title">
          <h2 id="schedule-title" className="font-display text-[20px] font-bold">
            Schedule
          </h2>
          <p className="mt-2 text-[16px] font-semibold">{ongoing.schedule}</p>
          <p className="text-sm text-muted">
            {requested
              ? "Nothing is charged until the pro accepts."
              : `${ongoing.counts.upcoming} upcoming · ${ongoing.counts.done} done. Each visit is charged to your saved card 3 days before it, and you get a reminder the day before.`}
          </p>
        </Card>
      ) : (
        <Card as="section" aria-labelledby="contract-title">
          <h2 id="contract-title" className="font-display text-[20px] font-bold">
            Contract
          </h2>
          <p className="mt-2 text-[16px] font-semibold">{ongoing.terms.season}</p>
          <p className="text-sm text-muted">
            Cleared whenever snowfall reaches {ongoing.terms.triggerCm} cm.{" "}
            {ongoing.pricing === "per_visit"
              ? "Each visit is charged once you confirm it (or 48 hours after it's logged)."
              : `${ongoing.season?.paymentLabel}.`}
          </p>
          {ongoing.agreement ? (
            <p className="mt-3">
              <a
                href={ongoing.agreement.path}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center font-semibold text-primary"
              >
                Download the agreement (PDF)
              </a>
            </p>
          ) : null}
        </Card>
      )}

      {ongoing.kind === "snow_contract" && ongoing.season && ongoing.season.months.length > 0 ? (
        <Card as="section" aria-labelledby="months-title">
          <h2 id="months-title" className="font-display text-[20px] font-bold">
            Season payments
          </h2>
          <ul className="mt-3 grid gap-2 text-[15px]">
            {ongoing.season.months.map((month) => (
              <li key={month.sequence} className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold">{month.label}</span>
                <span className="text-muted">
                  {formatCad(month.totalCents)} ·{" "}
                  {month.state === "scheduled" && month.chargeDueAt
                    ? `Charged ${shortDay.format(month.chargeDueAt)}`
                    : month.refundedCents > 0
                      ? `${formatCad(month.refundedCents)} refunded`
                      : (MONTH_STATE[month.state] ?? "")}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card as="section" aria-labelledby="visits-title">
        <h2 id="visits-title" className="font-display text-[20px] font-bold">
          Visits
        </h2>
        {ongoing.visits.length === 0 ? (
          <p className="mt-2 text-[15px] text-muted">
            {requested
              ? `The visits go on the calendar once ${booking.business.name} accepts.`
              : snow
                ? `${booking.business.name} logs a visit each time they clear your snow.`
                : "No visits left."}
          </p>
        ) : (
          <ul className="mt-3">
            {ongoing.visits.map((visit) => (
              <VisitRow key={visit.id} booking={booking} visit={visit} />
            ))}
          </ul>
        )}
      </Card>

      {booking.actions.cancel ? (
        <Card as="section" aria-labelledby="end-title">
          <h2 id="end-title" className="font-display text-[20px] font-bold">
            {requested ? "Changed your mind?" : `End the ${thing}`}
          </h2>
          {end.error ? (
            <FormAlert tone="error" className="mt-3">
              {end.error.message}
            </FormAlert>
          ) : null}
          {confirmingEnd ? (
            <div className="nv-pop-in mt-3 grid gap-3 rounded-input border border-border bg-ground p-4">
              <p className="text-[15px]">
                {requested
                  ? "Cancel this request? Nothing has been charged."
                  : snow
                    ? ongoing.pricing === "season"
                      ? "Visits already done stay paid. You keep paying for this month; later months aren't charged (or are refunded if you paid upfront)."
                      : "Visits already done are still owed. No more visits after today."
                    : "Upcoming visits are cancelled: free outside the cancellation window, otherwise the policy applies to that visit. Visits already done aren't affected."}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  className="bg-danger hover:bg-danger"
                  onClick={() => end.mutate({ bookingId: booking.id })}
                  disabled={end.isPending}
                >
                  {end.isPending ? "Ending…" : requested ? "Cancel request" : `End the ${thing}`}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmingEnd(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3">
              <Button variant="secondary" onClick={() => setConfirmingEnd(true)}>
                {requested ? "Cancel request" : `End the ${thing}`}
              </Button>
            </div>
          )}
        </Card>
      ) : null}
    </>
  );
}
