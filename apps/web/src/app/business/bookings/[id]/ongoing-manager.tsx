"use client";

import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { formatCad } from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import { useId, useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { StatusPill } from "@/app/bookings/status-pill.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Field, Input, Select } from "@/components/ui/field.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useTRPC } from "@/lib/trpc.ts";

type View = inferRouterOutputs<AppRouter>["businessBookings"]["ongoing"];
type Visit = View["ongoing"]["visits"][number];
type Members = ReadonlyArray<{ id: string; name: string }>;

const shortDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Halifax",
  weekday: "short",
  month: "short",
  day: "numeric",
});

function useRefresh(businessId: string, bookingId: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.businessBookings.ongoing.queryKey({ businessId, bookingId }),
      }),
      queryClient.invalidateQueries({ queryKey: trpc.businessBookings.calendar.queryKey() }),
    ]);
}

function money(visit: Visit): string | null {
  const { charge } = visit;
  if (charge.state === "scheduled" && charge.dueAt)
    return `Charged ${shortDay.format(charge.dueAt)}`;
  if (charge.state === "charged") return `Paid ${formatCad(charge.amountCents)}`;
  if (charge.state === "partly_refunded")
    return `Paid, ${formatCad(charge.refundedCents)} refunded`;
  if (charge.state === "refunded") return "Refunded";
  if (charge.state === "failed") return "Customer's card declined: retrying";
  if (charge.state === "charging") return "Payment going through";
  return null;
}

/** Moving one visit: pick a day, then an open window that day. */
function MoveVisit({
  businessId,
  bookingId,
  visit,
  onDone,
}: {
  businessId: string;
  bookingId: string;
  visit: Visit;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const refresh = useRefresh(businessId, bookingId);
  const [date, setDate] = useState("");
  const [windowStart, setWindowStart] = useState("");
  const options = useQuery({
    ...trpc.businessBookings.moveOptions.queryOptions({
      businessId,
      bookingId,
      visitId: visit.id,
      from: date || undefined,
      days: 1,
    }),
    enabled: date !== "",
  });
  const move = useMutation(
    trpc.businessBookings.moveVisit.mutationOptions({
      onSuccess: async () => {
        await refresh();
        onDone();
      },
    }),
  );
  const windows = options.data?.days[0]?.windows ?? [];
  return (
    <form
      method="post"
      className="nv-pop-in grid gap-3 rounded-input bg-ground p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!date || windowStart === "") return;
        move.mutate({
          businessId,
          bookingId,
          visitId: visit.id,
          date,
          windowStart: Number(windowStart),
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="New day">
          <Input
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setWindowStart("");
            }}
          />
        </Field>
        <Field label="Arrival window">
          <Select
            value={windowStart}
            disabled={!date || options.isPending}
            onChange={(event) => setWindowStart(event.target.value)}
          >
            <option value="">{date ? "Pick a window" : "Pick a day first"}</option>
            {windows.map((window) => (
              <option
                key={window.startMinute}
                value={window.startMinute}
                disabled={!window.available || window.current}
              >
                {window.label}
                {window.current ? " (now)" : window.available ? "" : " (full)"}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {move.error ? <FormAlert tone="error">{move.error.message}</FormAlert> : null}
      <p className="text-sm text-muted">The customer is told and can reply in chat.</p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={move.isPending || windowStart === ""}>
          Move visit
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Never mind
        </Button>
      </div>
    </form>
  );
}

function VisitRow({
  view,
  visit,
  businessId,
  members,
  canManage,
}: {
  view: View;
  visit: Visit;
  businessId: string;
  members: Members;
  canManage: boolean;
}) {
  const trpc = useTRPC();
  const refresh = useRefresh(businessId, view.id);
  const fieldId = useId();
  const [panel, setPanel] = useState<"move" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const options = { onSuccess: refresh };
  const markDone = useMutation(trpc.businessBookings.markDone.mutationOptions(options));
  const scheduleFix = useMutation(trpc.businessBookings.scheduleFix.mutationOptions(options));
  const markFixed = useMutation(trpc.businessBookings.markFixed.mutationOptions(options));
  const assign = useMutation(trpc.businessBookings.assign.mutationOptions(options));
  const cancel = useMutation(
    trpc.businessBookings.cancel.mutationOptions({
      onSuccess: async () => {
        await refresh();
        setPanel(null);
      },
    }),
  );
  const all = [markDone, scheduleFix, markFixed, assign, cancel];
  const error = all.find((mutation) => mutation.error)?.error;
  const busy = all.some((mutation) => mutation.isPending);
  const input = { businessId, bookingId: view.id, visitId: visit.id };
  const actions = "move" in visit.actions ? visit.actions : null;
  const note = money(visit);
  if (!actions) return null;

  return (
    <li className="grid gap-2 border-t border-border py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[16px] font-semibold">{visit.window.label}</p>
          <p className="text-sm text-muted">
            Visit {visit.sequence}
            {note ? ` · ${note}` : ""}
          </p>
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
                alt="Cleared driveway, as logged"
                className="size-20 rounded-input border border-border object-cover"
              />
            </a>
          ))}
        </div>
      ) : null}
      {error ? <FormAlert tone="error">{error.message}</FormAlert> : null}
      {actions.assign && canManage ? (
        <div className="max-w-xs">
          <label className="sr-only" htmlFor={`assign-${fieldId}`}>
            Crew member
          </label>
          <Select
            id={`assign-${fieldId}`}
            value={visit.assignee?.id ?? ""}
            disabled={busy}
            className="h-11"
            onChange={(event) => assign.mutate({ ...input, memberId: event.target.value || null })}
          >
            <option value="">Not assigned yet</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
        </div>
      ) : visit.assignee ? (
        <p className="text-sm">Crew: {visit.assignee.name}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {actions.markDone ? (
          <Button size="sm" disabled={busy} onClick={() => markDone.mutate(input)}>
            Mark done
          </Button>
        ) : null}
        {actions.scheduleFix ? (
          <Button size="sm" disabled={busy} onClick={() => scheduleFix.mutate(input)}>
            We'll come back to fix it
          </Button>
        ) : null}
        {actions.markFixed ? (
          <Button size="sm" disabled={busy} onClick={() => markFixed.mutate(input)}>
            Mark fixed
          </Button>
        ) : null}
        {actions.move && canManage && panel === null ? (
          <Button size="sm" variant="secondary" onClick={() => setPanel("move")}>
            Move
          </Button>
        ) : null}
        {actions.cancel && canManage && panel === null ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-danger hover:text-danger"
            onClick={() => setPanel("cancel")}
          >
            Cancel this visit
          </Button>
        ) : null}
      </div>
      {panel === "move" ? (
        <MoveVisit
          businessId={businessId}
          bookingId={view.id}
          visit={visit}
          onDone={() => setPanel(null)}
        />
      ) : null}
      {panel === "cancel" ? (
        <form
          method="post"
          className="nv-pop-in grid gap-2 rounded-input bg-ground p-3"
          onSubmit={(event) => {
            event.preventDefault();
            cancel.mutate({ ...input, reason });
          }}
        >
          <label htmlFor={`reason-${fieldId}`} className="text-sm font-semibold">
            Why are you cancelling this visit? If it was charged, the customer gets it back in full.
          </label>
          <Input
            id={`reason-${fieldId}`}
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" className="bg-danger hover:bg-danger" disabled={busy}>
              Cancel visit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
              Keep it
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

/** Ending a series or contract early, with the reason the customer is told. */
function EndCard({ view, businessId }: { view: View; businessId: string }) {
  const trpc = useTRPC();
  const refresh = useRefresh(businessId, view.id);
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const end = useMutation(trpc.businessBookings.endOngoing.mutationOptions({ onSuccess: refresh }));
  const snow = view.ongoing.kind === "snow_contract";
  return (
    <Card as="section" aria-labelledby="end-title">
      <h2 id="end-title" className="font-display text-[20px] font-bold">
        End the {snow ? "contract" : "series"}
      </h2>
      {end.data ? (
        <FormAlert tone="success" className="mt-3">
          Ended.{" "}
          {end.data.refundCents > 0
            ? `${formatCad(end.data.refundCents)} goes back to the customer.`
            : "Nothing needed refunding."}
        </FormAlert>
      ) : open ? (
        <form
          method="post"
          className="mt-3 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            end.mutate({ businessId, bookingId: view.id, reason });
          }}
        >
          <p className="text-[15px]">
            {snow
              ? "Visits already done stay paid. With a season price, the rest of this month is refunded day by day and later months aren't charged (or are refunded)."
              : "Upcoming visits are cancelled and refunded in full. Visits already done aren't affected."}
          </p>
          <Field label="Why? The customer sees this.">
            <Input
              id={`end-${fieldId}`}
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          {end.error ? <FormAlert tone="error">{end.error.message}</FormAlert> : null}
          <div className="flex gap-2">
            <Button type="submit" className="bg-danger hover:bg-danger" disabled={end.isPending}>
              End it
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-3">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            End the {snow ? "contract" : "series"}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** A recurring series or snow contract as the business manages it (SPEC §21). */
export function OngoingManager({
  businessId,
  bookingId,
  canManage,
}: {
  businessId: string;
  bookingId: string;
  canManage: boolean;
}) {
  const trpc = useTRPC();
  const refresh = useRefresh(businessId, bookingId);
  const view = useQuery(trpc.businessBookings.ongoing.queryOptions({ businessId, bookingId }));
  const team = useQuery({
    ...trpc.team.members.queryOptions({ businessId }),
    enabled: canManage,
  });
  const accept = useMutation(trpc.businessBookings.accept.mutationOptions({ onSuccess: refresh }));
  const decline = useMutation(
    trpc.businessBookings.decline.mutationOptions({ onSuccess: refresh }),
  );

  if (view.isPending) return <Skeleton className="h-96" />;
  if (view.isError) return <FormAlert tone="error">{view.error.message}</FormAlert>;
  const data = view.data;
  const { ongoing } = data;
  const members = (team.data ?? []).filter((member) => member.active);
  const snow = ongoing.kind === "snow_contract";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <div className="grid gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-[0.06em] text-primary uppercase">
              {snow ? "Snow contract" : "Recurring job"}
            </p>
            <h1 className="font-display text-[28px] leading-[1.1] font-extrabold tracking-[-0.03em] break-words sm:text-[34px]">
              {data.title}
            </h1>
            <p className="mt-1 text-[15px] text-muted">
              {data.customer.firstName}
              {data.conversationId ? (
                <>
                  {" · "}
                  <Link
                    href={`/inbox/${data.conversationId}` as Route}
                    className="font-semibold text-primary"
                  >
                    Message
                  </Link>
                </>
              ) : null}
            </p>
          </div>
          <StatusPill status={data.status} label={data.statusLabel} />
        </div>

        {ongoing.paused ? <FormAlert tone="error">{ongoing.paused.text}</FormAlert> : null}

        {data.actions.accept || data.actions.decline ? (
          <Card as="section" aria-labelledby="request-title">
            <h2 id="request-title" className="font-display text-[20px] font-bold">
              {snow ? "Sign-up waiting for you" : "Request waiting for you"}
            </h2>
            <p className="mt-1 text-[15px] text-muted">
              Accept or decline by{" "}
              {data.approvalExpiresAt ? shortDay.format(data.approvalExpiresAt) : "tomorrow"}.{" "}
              {snow
                ? "Accepting signs the agreement on your side and puts the address on your snow route."
                : "Accepting puts every visit that still fits on your calendar."}
            </p>
            {accept.data && accept.data.skipped.length > 0 ? (
              <FormAlert tone="success" className="mt-3">
                Accepted. These dates no longer fit and are skipped:{" "}
                {accept.data.skipped.join(", ")}.
              </FormAlert>
            ) : null}
            {accept.error || decline.error ? (
              <FormAlert tone="error" className="mt-3">
                {(accept.error ?? decline.error)?.message}
              </FormAlert>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                disabled={accept.isPending || decline.isPending}
                onClick={() => accept.mutate({ businessId, bookingId })}
              >
                Accept
              </Button>
              <Button
                variant="secondary"
                disabled={accept.isPending || decline.isPending}
                onClick={() => decline.mutate({ businessId, bookingId })}
              >
                Decline
              </Button>
            </div>
          </Card>
        ) : null}

        {snow && ongoing.season && ongoing.season.months.length > 0 ? (
          <Card as="section" aria-labelledby="months-title">
            <h2 id="months-title" className="font-display text-[20px] font-bold">
              Season payments
            </h2>
            <p className="mt-1 text-sm text-muted">
              {ongoing.season.paymentLabel}. You&apos;re paid each month&apos;s share after the
              month ends.
            </p>
            <ul className="mt-3 grid gap-2 text-[15px]">
              {ongoing.season.months.map((month) => (
                <li key={month.sequence} className="flex flex-wrap justify-between gap-2">
                  <span className="font-semibold">{month.label}</span>
                  <span className="text-muted">
                    you get {formatCad(month.payoutCents)} ·{" "}
                    {month.state === "scheduled" && month.chargeDueAt
                      ? `charged ${shortDay.format(month.chargeDueAt)}`
                      : month.state === "cancelled"
                        ? "not charged"
                        : month.state === "failed"
                          ? "card declined"
                          : month.refundedCents > 0
                            ? `${formatCad(month.refundedCents)} refunded`
                            : "paid"}
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
              {snow
                ? "Mark the address Cleared on your snow route after each storm."
                : data.status === "requested"
                  ? "Visits go on your calendar when you accept."
                  : "No visits."}
            </p>
          ) : (
            <ul className="mt-3">
              {ongoing.visits.map((visit) => (
                <VisitRow
                  key={visit.id}
                  view={data}
                  visit={visit}
                  businessId={businessId}
                  members={members}
                  canManage={canManage}
                />
              ))}
            </ul>
          )}
        </Card>

        {data.actions.end ? <EndCard view={data} businessId={businessId} /> : null}
      </div>

      <div className="grid gap-5">
        <Card as="section" aria-labelledby="details-title">
          <h2 id="details-title" className="font-display text-[20px] font-bold">
            {snow ? "Terms" : "Schedule"}
          </h2>
          {ongoing.kind === "recurring" ? (
            <p className="mt-2 text-[15px]">{ongoing.schedule}</p>
          ) : (
            <p className="mt-2 text-[15px]">
              {ongoing.terms.season}. Cleared from {ongoing.terms.triggerCm} cm.
            </p>
          )}
          {ongoing.perVisit ? (
            <p className="mt-2 text-sm text-muted">
              You get {formatCad(ongoing.perVisit.payoutCents)} per visit (price and HST, less
              Nevile&apos;s 3%).
            </p>
          ) : null}
          {ongoing.kind === "snow_contract" && ongoing.agreement ? (
            <a
              href={ongoing.agreement.path}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex min-h-11 items-center font-semibold text-primary"
            >
              Agreement (PDF)
            </a>
          ) : null}
          <address className="mt-3 text-[15px] not-italic">
            {data.address.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
          {data.customer.phone || data.customer.email ? (
            <p className="mt-1 text-sm text-muted">
              {[data.customer.phone, data.customer.email].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          {data.notes ? (
            <p className="mt-3 text-[15px] whitespace-pre-line">“{data.notes}”</p>
          ) : null}
          {data.cancellationReason ? (
            <p className="mt-3 text-sm text-muted">Ended: “{data.cancellationReason}”</p>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
