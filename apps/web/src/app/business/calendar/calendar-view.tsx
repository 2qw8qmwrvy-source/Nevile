"use client";

import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { addCalendarDays, formatCad, formatIsoDate, parseIsoDate, toLocal } from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Route } from "next";
import { useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { StatusPill } from "@/app/bookings/status-pill.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Input, Select } from "@/components/ui/field.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useTRPC } from "@/lib/trpc.ts";

type Calendar = inferRouterOutputs<AppRouter>["businessBookings"]["calendar"];
type Job = Calendar["days"][number]["windows"][number]["jobs"][number];
type Member = Calendar["members"][number];

const dayHeading = new Intl.DateTimeFormat("en-CA", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});
const asDate = (iso: string) => new Date(`${iso}T12:00:00Z`);
const hours = (minutes: number) => {
  const value = Math.round((minutes / 60) * 10) / 10;
  return `${value} h`;
};

function todayInHalifax(): string {
  const local = toLocal(new Date(), "America/Halifax");
  return formatIsoDate({ year: local.year, month: local.month, day: local.day });
}

function useBookingAction(businessId: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.businessBookings.calendar.queryKey() }),
      queryClient.invalidateQueries({
        queryKey: trpc.businessBookings.inbox.queryKey({ businessId }),
      }),
    ]);
}

/** One job (or request) with what the viewer can do to it. */
function JobCard({
  job,
  businessId,
  members,
  canManage,
}: {
  job: Job;
  businessId: string;
  members: Member[];
  canManage: boolean;
}) {
  const trpc = useTRPC();
  const refresh = useBookingAction(businessId);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const options = { onSuccess: refresh };
  const accept = useMutation(trpc.businessBookings.accept.mutationOptions(options));
  const decline = useMutation(trpc.businessBookings.decline.mutationOptions(options));
  const assign = useMutation(trpc.businessBookings.assign.mutationOptions(options));
  const markDone = useMutation(trpc.businessBookings.markDone.mutationOptions(options));
  const cancel = useMutation(trpc.businessBookings.cancel.mutationOptions(options));
  const scheduleFix = useMutation(trpc.businessBookings.scheduleFix.mutationOptions(options));
  const markFixed = useMutation(trpc.businessBookings.markFixed.mutationOptions(options));
  const error = [accept, decline, assign, markDone, cancel, scheduleFix, markFixed].find(
    (m) => m.error,
  )?.error;
  const busy = [accept, decline, assign, markDone, cancel, scheduleFix, markFixed].some(
    (m) => m.isPending,
  );
  const input = { businessId, bookingId: job.id };
  const { actions } = job;

  return (
    <article
      className="rounded-input border border-border bg-surface p-3.5"
      aria-label={`${job.service.title} for ${job.customer.firstName}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[16px] leading-snug font-semibold">{job.service.title}</h4>
          <p className="text-sm text-muted">
            {job.customer.firstName} · {hours(job.workMinutes)} · you get{" "}
            {formatCad(job.payout.cents)}
          </p>
        </div>
        <StatusPill status={job.status} label={job.statusLabel} />
      </div>
      <address className="mt-2 text-sm not-italic">
        {job.address.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </address>
      {job.customer.phone || job.customer.email ? (
        <p className="mt-1 text-sm text-muted">
          {[job.customer.phone, job.customer.email].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {job.notes ? <p className="mt-2 text-sm whitespace-pre-line">“{job.notes}”</p> : null}
      {error ? (
        <FormAlert tone="error" className="mt-2">
          {error.message}
        </FormAlert>
      ) : null}
      {actions.assign && canManage ? (
        <div className="mt-3">
          <label className="sr-only" htmlFor={`assign-${job.id}`}>
            Crew member
          </label>
          <Select
            id={`assign-${job.id}`}
            value={job.assignee?.id ?? ""}
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
      ) : job.assignee ? (
        <p className="mt-2 text-sm">Crew: {job.assignee.name}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {actions.accept && canManage ? (
          <Button size="sm" disabled={busy} onClick={() => accept.mutate(input)}>
            Accept
          </Button>
        ) : null}
        {actions.decline && canManage ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => decline.mutate(input)}
          >
            Decline
          </Button>
        ) : null}
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
        {job.conversationId ? (
          <Button size="sm" variant="secondary" href={`/inbox/${job.conversationId}` as Route}>
            Message
          </Button>
        ) : null}
        {actions.cancel && canManage && !cancelling ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-danger hover:text-danger"
            onClick={() => setCancelling(true)}
          >
            Cancel job
          </Button>
        ) : null}
      </div>
      {cancelling ? (
        <form
          method="post"
          className="mt-3 grid gap-2 rounded-input bg-ground p-3"
          onSubmit={(event) => {
            event.preventDefault();
            cancel.mutate({ ...input, reason });
          }}
        >
          <label htmlFor={`reason-${job.id}`} className="text-sm font-semibold">
            Why are you cancelling? The customer gets a full refund, and it counts on your
            reliability.
          </label>
          <Input
            id={`reason-${job.id}`}
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" className="bg-danger hover:bg-danger" disabled={busy}>
              Cancel and refund
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCancelling(false)}>
              Keep the job
            </Button>
          </div>
        </form>
      ) : null}
    </article>
  );
}

/** Week view by day and arrival window, plus an inbox of what needs an answer. */
export function CalendarView({
  businessId,
  canManage,
}: {
  businessId: string;
  canManage: boolean;
}) {
  const trpc = useTRPC();
  const [from, setFrom] = useState(todayInHalifax);
  const calendar = useQuery(
    trpc.businessBookings.calendar.queryOptions({ businessId, from, days: 7 }),
  );
  const inbox = useQuery({
    ...trpc.businessBookings.inbox.queryOptions({ businessId }),
    enabled: canManage,
  });
  const members = calendar.data?.members ?? [];
  const shift = (days: number) => {
    const date = parseIsoDate(from);
    if (date) setFrom(formatIsoDate(addCalendarDays(date, days)));
  };
  const needsAnswer = inbox.data
    ? [...inbox.data.requests, ...inbox.data.problems, ...inbox.data.unassigned]
    : [];

  return (
    <div className="grid gap-6">
      {canManage && needsAnswer.length > 0 ? (
        <Card as="section" aria-labelledby="inbox-title" className="border-season-tint">
          <h2 id="inbox-title" className="font-display text-[22px] font-bold">
            Needs you
          </h2>
          <p className="mt-1 text-[15px] text-muted">
            Requests to answer, problems to fix and jobs nobody is assigned to yet.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {needsAnswer.map((job) => (
              <div key={job.id}>
                <p className="mb-1 text-sm font-semibold">{job.window.label}</p>
                <JobCard
                  job={job}
                  businessId={businessId}
                  members={members}
                  canManage={canManage}
                />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <section aria-labelledby="week-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="week-title" className="font-display text-[22px] font-bold">
            {canManage ? "This week" : "Your jobs"}
          </h2>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => shift(-7)}>
              Previous week
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setFrom(todayInHalifax())}>
              Today
            </Button>
            <Button variant="secondary" size="sm" onClick={() => shift(7)}>
              Next week
            </Button>
          </div>
        </div>
        {calendar.isPending ? (
          <div className="mt-4 grid gap-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : calendar.isError ? (
          <FormAlert tone="error" className="mt-4">
            {calendar.error.message}
          </FormAlert>
        ) : (
          <ol className="mt-4 grid gap-4">
            {calendar.data.days.map((day) => {
              const jobs = day.windows.reduce((sum, window) => sum + window.jobs.length, 0);
              return (
                <li key={day.date}>
                  <Card padding="sm" className="sm:p-5">
                    <h3 className="text-[17px] font-semibold">
                      {dayHeading.format(asDate(day.date))}
                      <span className="ml-2 text-sm font-normal text-muted">
                        {jobs === 0 ? "No jobs" : `${jobs} ${jobs === 1 ? "job" : "jobs"}`}
                      </span>
                    </h3>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {day.windows.map((window) => {
                        const used = window.capacityMinutes - window.freeMinutes;
                        const share =
                          window.capacityMinutes > 0 ? used / window.capacityMinutes : 1;
                        return (
                          <div key={window.startMinute} className="rounded-input bg-ground p-3">
                            <p className="flex items-baseline justify-between gap-2 text-sm font-semibold">
                              {window.label}
                              <span className="font-normal text-muted">
                                {window.capacityMinutes === 0
                                  ? "Nobody working"
                                  : `${hours(used)} of ${hours(window.capacityMinutes)} booked`}
                              </span>
                            </p>
                            <div
                              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border"
                              aria-hidden="true"
                            >
                              <div
                                className="h-full bg-primary"
                                style={{ width: `${Math.min(100, Math.round(share * 100))}%` }}
                              />
                            </div>
                            <div className="mt-3 grid gap-2">
                              {window.jobs.map((job) => (
                                <JobCard
                                  key={job.id}
                                  job={job}
                                  businessId={businessId}
                                  members={members}
                                  canManage={canManage}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                </li>
              );
            })}
            {calendar.data.other.length > 0 ? (
              <li>
                <Card padding="sm" className="sm:p-5">
                  <h3 className="text-[17px] font-semibold">Outside your current windows</h3>
                  <p className="mt-1 text-sm text-muted">
                    Booked before you changed your arrival windows.
                  </p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {calendar.data.other.map((job) => (
                      <div key={job.id}>
                        <p className="mb-1 text-sm font-semibold">{job.window.label}</p>
                        <JobCard
                          job={job}
                          businessId={businessId}
                          members={members}
                          canManage={canManage}
                        />
                      </div>
                    ))}
                  </div>
                </Card>
              </li>
            ) : null}
          </ol>
        )}
      </section>
    </div>
  );
}
