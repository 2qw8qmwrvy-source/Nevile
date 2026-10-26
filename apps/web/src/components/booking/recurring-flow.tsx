"use client";

import {
  addCalendarDays,
  addCalendarMonths,
  formatCad,
  formatIsoDate,
  parseIsoDate,
  postalAreaOf,
  type RecurrenceFrequency,
  seriesLastAllowedDate,
} from "@nevile/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { CardSetupButton } from "@/app/account/card/card-setup-button.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Field, Input } from "@/components/ui/field.tsx";
import { ArrowRightIcon } from "@/components/ui/icons.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/cn.ts";
import { useTRPC } from "@/lib/trpc.ts";
import { AddressCard, addressProblem, type JobAddress } from "./address-card.tsx";
import { DayWindowPicker } from "./day-window-picker.tsx";

/** A pro's fixed-price service on a schedule, or the recurring offer in their quote. */
export type RecurringSource =
  | { kind: "service"; serviceId: string }
  | { kind: "quote"; quoteId: string };

type RecurringFlowProps = {
  source: RecurringSource;
  defaultPostal: string;
  /** This page's path, to come back to after adding a card. */
  returnPath: string;
};

const DAYS_PER_PAGE = 7;
const FREQUENCY_TEXT: Record<RecurrenceFrequency, string> = {
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  monthly: "Every month",
};

/**
 * Recurring visits (SPEC §21): pick a schedule, the first visit and the last day, see
 * every date checked against the pro's calendar (skip or move full ones), then send. A
 * listed service needs the pro's OK; a pro's own offer is confirmed straight away.
 */
export function RecurringFlow({ source, defaultPostal, returnPath }: RecurringFlowProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const [frequency, setFrequency] = useState<RecurrenceFrequency | null>(null);
  const [from, setFrom] = useState<string | undefined>(undefined);
  const [date, setDate] = useState<string | null>(null);
  const [windowStart, setWindowStart] = useState<number | null>(null);
  const [endDate, setEndDate] = useState("");
  const [overrides, setOverrides] = useState<ReadonlyMap<string, number | null>>(new Map());
  const [address, setAddress] = useState<JobAddress>({
    line1: "",
    line2: "",
    city: "",
    postalCode: defaultPostal,
  });
  const [notes, setNotes] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const service = useQuery({
    ...trpc.bookings.availability.queryOptions({
      serviceId: source.kind === "service" ? source.serviceId : "",
      from,
      days: DAYS_PER_PAGE,
    }),
    enabled: source.kind === "service",
  });
  const quote = useQuery({
    ...trpc.quotes.bookingOptions.queryOptions({
      quoteId: source.kind === "quote" ? source.quoteId : "",
      from,
      days: DAYS_PER_PAGE,
    }),
    enabled: source.kind === "quote",
  });
  const card = useQuery(trpc.cards.get.queryOptions());
  const availability = source.kind === "service" ? service : quote;
  const days = availability.data?.days;
  const frequencies: RecurrenceFrequency[] =
    source.kind === "service"
      ? (service.data?.service.recurrenceFrequencies ?? [])
      : (quote.data?.quote?.frequencies.map((option) => option.value) ?? []);
  const chosenFrequency = frequency ?? (frequencies.length === 1 ? (frequencies[0] ?? null) : null);
  const title = source.kind === "service" ? service.data?.service.title : quote.data?.title;
  const policy =
    source.kind === "service" ? service.data?.cancellationPolicy : quote.data?.cancellationPolicy;

  const first = date ? parseIsoDate(date) : null;
  const lastAllowed = first ? formatIsoDate(seriesLastAllowedDate(first)) : undefined;
  const earliestEnd = first ? formatIsoDate(addCalendarDays(first, 1)) : undefined;
  const schedule = useMemo(
    () =>
      chosenFrequency && date && windowStart !== null && endDate
        ? {
            frequency: chosenFrequency,
            date,
            windowStart,
            endDate,
            overrides: [...overrides].map(([day, start]) => ({ date: day, windowStart: start })),
          }
        : null,
    [chosenFrequency, date, windowStart, endDate, overrides],
  );
  const previewInput = schedule ?? {
    frequency: "weekly" as const,
    date: "2000-01-03",
    windowStart: 0,
    endDate: "2000-01-10",
    overrides: [],
  };
  const servicePreview = useQuery({
    ...trpc.recurring.preview.queryOptions({
      ...previewInput,
      serviceId: source.kind === "service" ? source.serviceId : "",
    }),
    enabled: source.kind === "service" && schedule !== null,
  });
  const quotePreview = useQuery({
    ...trpc.recurring.previewQuote.queryOptions({
      ...previewInput,
      quoteId: source.kind === "quote" ? source.quoteId : "",
    }),
    enabled: source.kind === "quote" && schedule !== null,
  });
  const preview = source.kind === "service" ? servicePreview : quotePreview;

  const booked = {
    onSuccess: ({ bookingId }: { bookingId: string }) =>
      router.push(`/bookings/${bookingId}?new=1` as Route),
  };
  const request = useMutation(trpc.recurring.request.mutationOptions(booked));
  const requestQuote = useMutation(trpc.recurring.requestFromQuote.mutationOptions(booked));
  const sending = source.kind === "service" ? request : requestQuote;
  const fieldErrors = sending.error?.data?.zodError?.fieldErrors as
    | Record<string, string[] | undefined>
    | undefined;

  function chooseFirst(next: string) {
    setDate(next);
    setWindowStart(null);
    setOverrides(new Map());
    const start = parseIsoDate(next);
    if (
      start &&
      (!endDate || endDate <= next || endDate > formatIsoDate(seriesLastAllowedDate(start)))
    ) {
      setEndDate(formatIsoDate(addCalendarMonths(start, 3)));
    }
  }

  function page(by: number) {
    const start = parseIsoDate(days?.[0]?.date ?? availability.data?.firstDate ?? "");
    if (!start) return;
    setFrom(formatIsoDate(addCalendarDays(start, by * DAYS_PER_PAGE)));
  }

  function change(day: string, start: number | null | undefined) {
    setOverrides((current) => {
      const next = new Map(current);
      if (start === undefined) next.delete(day);
      else next.set(day, start);
      return next;
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    if (!schedule) {
      setProblem("Pick how often, the first visit and when it ends.");
      return;
    }
    if (preview.data?.problem) {
      setProblem(preview.data.problem);
      return;
    }
    const addressIssue = addressProblem(address, postalAreaOf);
    if (addressIssue) {
      setProblem(addressIssue);
      return;
    }
    if (source.kind === "quote") {
      requestQuote.mutate({ ...schedule, quoteId: source.quoteId, address, notes });
    } else {
      request.mutate({ ...schedule, serviceId: source.serviceId, address, notes });
    }
  }

  const firstShown = days?.[0]?.date;
  const lastShown = days?.at(-1)?.date;
  const data = availability.data;
  const canGoBack = Boolean(data && firstShown && firstShown > data.firstDate);
  const canGoForward = Boolean(data && lastShown && lastShown < data.lastDate);
  const plan = preview.data;

  return (
    <form
      method="post"
      onSubmit={onSubmit}
      noValidate
      className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start"
    >
      <div className="grid gap-6">
        <Card as="section" aria-labelledby="card-title">
          <h2 id="card-title" className="font-display text-[20px] font-bold">
            Payment card
          </h2>
          {card.isPending ? (
            <Skeleton className="mt-3 h-6 w-48" />
          ) : card.data ? (
            <p className="mt-2 text-[15px]">
              Each visit is charged to <strong>{card.data.label}</strong>, 3 days before it.{" "}
              <a
                href={`/account/card?next=${encodeURIComponent(returnPath)}`}
                className="font-semibold text-primary"
              >
                Change
              </a>
            </p>
          ) : (
            <>
              <p className="mt-2 text-[15px] text-muted">
                Recurring visits are charged to a saved card, 3 days before each visit. Add one
                first; you&apos;ll come straight back here.
              </p>
              <div className="mt-3">
                <CardSetupButton returnPath={returnPath} label="Add a card" />
              </div>
            </>
          )}
        </Card>

        <Card as="section" aria-labelledby="often-title">
          <h2 id="often-title" className="font-display text-[20px] font-bold">
            How often
          </h2>
          {frequencies.length === 0 ? (
            <Skeleton className="mt-3 h-12" />
          ) : (
            <fieldset className="mt-3 grid gap-2 sm:grid-cols-3">
              <legend className="sr-only">How often</legend>
              {frequencies.map((option) => (
                <label
                  key={option}
                  className={cn(
                    "flex min-h-12 cursor-pointer items-center gap-2.5 rounded-input border px-3.5 py-2 text-[15px] font-semibold transition-colors",
                    chosenFrequency === option
                      ? "border-primary bg-primary-soft"
                      : "border-border hover:border-field",
                  )}
                >
                  <input
                    type="radio"
                    name="frequency"
                    value={option}
                    checked={chosenFrequency === option}
                    onChange={() => {
                      setFrequency(option);
                      setOverrides(new Map());
                    }}
                    className="size-4 accent-primary"
                  />
                  {FREQUENCY_TEXT[option]}
                </label>
              ))}
            </fieldset>
          )}
        </Card>

        <DayWindowPicker
          title="First visit"
          hint="Later visits keep this weekday (or day of the month) and arrival window."
          days={days}
          loading={availability.isPending}
          error={availability.isError ? availability.error.message : null}
          date={date}
          windowStart={windowStart}
          onDate={chooseFirst}
          onWindow={(start) => {
            setWindowStart(start);
            setOverrides(new Map());
          }}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onPage={page}
        />

        <Card as="section" aria-labelledby="until-title">
          <h2 id="until-title" className="font-display text-[20px] font-bold">
            Until
          </h2>
          <Field
            label="Last day"
            hint="Up to 6 months after the first visit. You can end it early any time."
            className="mt-3 max-w-xs"
            error={fieldErrors?.endDate?.[0]}
          >
            <Input
              type="date"
              value={endDate}
              min={earliestEnd}
              max={lastAllowed}
              disabled={!first}
              onChange={(event) => {
                setEndDate(event.target.value);
                setOverrides(new Map());
              }}
            />
          </Field>
        </Card>

        {schedule ? (
          <Card as="section" aria-labelledby="dates-title">
            <h2 id="dates-title" className="font-display text-[20px] font-bold">
              Your visits
            </h2>
            {preview.isPending ? (
              <Skeleton className="mt-3 h-32" />
            ) : preview.isError ? (
              <FormAlert tone="error" className="mt-3">
                {preview.error.message}
              </FormAlert>
            ) : plan ? (
              <>
                <p className="mt-1 text-[15px] text-muted">{plan.summary}</p>
                <ul className="mt-3 grid gap-2">
                  {plan.dates.map((visit) => (
                    <li
                      key={visit.date}
                      className={cn(
                        "grid gap-2 rounded-input border px-3.5 py-2.5 text-[15px]",
                        visit.status === "ok" || visit.status === "skipped"
                          ? "border-border"
                          : "border-season bg-season-tint/40",
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{visit.label}</span>
                        <span className="text-muted">
                          {visit.status === "ok"
                            ? visit.windowLabel
                            : visit.status === "skipped"
                              ? "Skipped"
                              : "Full"}
                        </span>
                      </div>
                      {visit.status === "skipped" ? (
                        <div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => change(visit.date, undefined)}
                          >
                            Undo skip
                          </Button>
                        </div>
                      ) : visit.status !== "ok" ? (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => change(visit.date, null)}
                          >
                            Skip this date
                          </Button>
                          {visit.alternatives.map((alternative) => (
                            <Button
                              key={alternative.startMinute}
                              size="sm"
                              variant="secondary"
                              onClick={() => change(visit.date, alternative.startMinute)}
                            >
                              Move to {alternative.label}
                            </Button>
                          ))}
                        </div>
                      ) : overrides.has(visit.date) ? (
                        <div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => change(visit.date, undefined)}
                          >
                            Back to the usual window
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {plan.problem ? (
                  <FormAlert tone="error" className="mt-3">
                    {plan.problem}
                  </FormAlert>
                ) : null}
              </>
            ) : null}
          </Card>
        ) : null}

        <AddressCard
          hint="The pro sees the address once the first visit is paid."
          address={address}
          onAddress={setAddress}
          notes={notes}
          onNotes={setNotes}
          error={fieldErrors?.address?.[0]}
        />
      </div>

      <aside className="lg:sticky lg:top-24" aria-label="Summary">
        <Card>
          <h2 className="font-display text-[20px] font-bold">Summary</h2>
          {title ? <p className="mt-2 text-[15px] font-semibold">{title}</p> : null}
          {plan ? (
            <>
              <p className="text-sm text-muted">{plan.summary}</p>
              <dl className="mt-4 grid gap-1.5 text-[15px]">
                <div className="flex justify-between">
                  <dt>Each visit</dt>
                  <dd>{formatCad(plan.price.priceCents)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Service fee</dt>
                  <dd>{formatCad(plan.price.serviceFeeCents)}</dd>
                </div>
                {plan.price.taxCents > 0 ? (
                  <div className="flex justify-between">
                    <dt>HST</dt>
                    <dd>{formatCad(plan.price.taxCents)}</dd>
                  </div>
                ) : null}
                <div className="mt-1 flex justify-between border-t border-border pt-2 font-semibold">
                  <dt>Per visit</dt>
                  <dd>{formatCad(plan.price.totalCents)}</dd>
                </div>
                <div className="flex justify-between text-muted">
                  <dt>{plan.visits} visits</dt>
                  <dd>{formatCad(plan.totalCents)}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">
              Pick a schedule to see your visits and the price.
            </p>
          )}
          <div className="mt-4 grid gap-2 text-sm text-muted">
            {source.kind === "quote" ? (
              <p>
                <strong className="text-ink">Confirmed straight away:</strong> it&apos;s the
                pro&apos;s own offer.
              </p>
            ) : (
              <p>
                <strong className="text-ink">Needs the pro&apos;s OK.</strong> Nothing is charged
                until they accept (within 24 hours).
              </p>
            )}
            <p>Each visit is charged 3 days before it. You get a reminder the day before.</p>
            {policy ? (
              <p>
                <strong className="text-ink">{policy.label} cancellation</strong> applies to each
                visit you skip. {policy.description}
              </p>
            ) : null}
          </div>
          {problem || (sending.error && !fieldErrors) ? (
            <FormAlert tone="error" className="mt-4">
              {problem ?? sending.error?.message}
            </FormAlert>
          ) : null}
          <Button
            type="submit"
            size="lg"
            block
            className="mt-5"
            disabled={sending.isPending || sending.isSuccess || !card.data}
            aria-busy={sending.isPending}
          >
            {sending.isPending || sending.isSuccess
              ? "Sending…"
              : source.kind === "quote"
                ? "Book these visits"
                : "Send request"}
            <ArrowRightIcon size={18} />
          </Button>
          {!card.data && !card.isPending ? (
            <p className="mt-2 text-center text-xs text-muted">Add a card above to continue.</p>
          ) : null}
        </Card>
      </aside>
    </form>
  );
}
