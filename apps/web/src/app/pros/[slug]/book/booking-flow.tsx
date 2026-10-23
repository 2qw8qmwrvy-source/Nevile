"use client";

import {
  addCalendarDays,
  formatCad,
  formatIsoDate,
  parseIsoDate,
  postalAreaOf,
} from "@nevile/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Field, Input, Select, Textarea } from "@/components/ui/field.tsx";
import { ArrowRightIcon, LockIcon } from "@/components/ui/icons.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/cn.ts";
import { useTRPC } from "@/lib/trpc.ts";

type BookingFlowProps = {
  slug: string;
  services: ReadonlyArray<{ id: string; title: string; priceText: string }>;
  initialServiceId: string;
  defaultPostal: string;
};

const DAYS_PER_PAGE = 7;
const dayName = new Intl.DateTimeFormat("en-CA", { weekday: "short", timeZone: "UTC" });
const dayNumber = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const longDay = new Intl.DateTimeFormat("en-CA", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});
/** Calendar dates are shown as-is (they're already local days), so format them in UTC. */
const asDate = (iso: string) => new Date(`${iso}T12:00:00Z`);

/**
 * Pick a day and arrival window, enter the address, review the price, then pay on the
 * payment provider's page (SPEC §19). The server re-checks everything.
 */
export function BookingFlow({ services, initialServiceId, defaultPostal }: BookingFlowProps) {
  const trpc = useTRPC();
  const [serviceId, setServiceId] = useState(initialServiceId);
  const [from, setFrom] = useState<string | undefined>(undefined);
  const [date, setDate] = useState<string | null>(null);
  const [windowStart, setWindowStart] = useState<number | null>(null);
  const [address, setAddress] = useState({
    line1: "",
    line2: "",
    city: "",
    postalCode: defaultPostal,
  });
  const [notes, setNotes] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const availability = useQuery(
    trpc.bookings.availability.queryOptions({ serviceId, from, days: DAYS_PER_PAGE }),
  );
  const checkout = useMutation(
    trpc.bookings.checkout.mutationOptions({
      onSuccess: ({ url }) => window.location.assign(url),
    }),
  );
  const data = availability.data;
  const day = data?.days.find((candidate) => candidate.date === date) ?? null;
  const chosenWindow = day?.windows.find((window) => window.startMinute === windowStart) ?? null;
  const fieldErrors = checkout.error?.data?.zodError?.fieldErrors as
    | Record<string, string[] | undefined>
    | undefined;

  function page(by: number) {
    const start = parseIsoDate(data?.days[0]?.date ?? data?.firstDate ?? "");
    if (!start) return;
    setFrom(formatIsoDate(addCalendarDays(start, by * DAYS_PER_PAGE)));
    setDate(null);
    setWindowStart(null);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    if (!date || windowStart === null) {
      setProblem("Pick a day and an arrival window.");
      return;
    }
    if (!address.line1.trim() || !address.city.trim()) {
      setProblem("Enter the street address and town.");
      return;
    }
    if (!postalAreaOf(address.postalCode)) {
      setProblem("Enter a postal code like B3H 1A1.");
      return;
    }
    checkout.mutate({ serviceId, date, windowStart, address, notes });
  }

  const firstShown = data?.days[0]?.date;
  const canGoBack = Boolean(data && firstShown && firstShown > data.firstDate);
  const lastShown = data?.days.at(-1)?.date;
  const canGoForward = Boolean(data && lastShown && lastShown < data.lastDate);

  return (
    <form
      method="post"
      onSubmit={onSubmit}
      noValidate
      className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start"
    >
      <div className="grid gap-6">
        {services.length > 1 ? (
          <Card as="section" aria-labelledby="service-title">
            <h2 id="service-title" className="font-display text-[20px] font-bold">
              Service
            </h2>
            <Select
              aria-label="Service"
              className="mt-3"
              value={serviceId}
              onChange={(event) => {
                setServiceId(event.target.value);
                setDate(null);
                setWindowStart(null);
              }}
            >
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.title} · {service.priceText}
                </option>
              ))}
            </Select>
          </Card>
        ) : null}

        <Card as="section" aria-labelledby="when-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="when-title" className="font-display text-[20px] font-bold">
              When
            </h2>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={!canGoBack} onClick={() => page(-1)}>
                Earlier
              </Button>
              <Button variant="ghost" size="sm" disabled={!canGoForward} onClick={() => page(1)}>
                Later
              </Button>
            </div>
          </div>
          <p className="mt-1 text-[15px] text-muted">
            Pick a day, then the window when the crew can arrive.
          </p>
          {availability.isPending ? (
            <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-7">
              {Array.from({ length: 7 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders.
                <Skeleton key={index} className="h-16" />
              ))}
            </div>
          ) : availability.isError ? (
            <FormAlert tone="error" className="mt-4">
              {availability.error.message}
            </FormAlert>
          ) : (
            <>
              <fieldset className="mt-4">
                <legend className="sr-only">Day</legend>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                  {data?.days.map((candidate) => {
                    const open = candidate.windows.some((window) => window.available);
                    const selected = candidate.date === date;
                    return (
                      <button
                        key={candidate.date}
                        type="button"
                        disabled={!open}
                        aria-pressed={selected}
                        onClick={() => {
                          setDate(candidate.date);
                          setWindowStart(null);
                        }}
                        className={cn(
                          "flex min-h-16 flex-col items-center justify-center rounded-input border text-center transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                          selected
                            ? "border-primary bg-primary-soft text-primary"
                            : "border-border bg-surface hover:border-field",
                        )}
                      >
                        <span className="text-xs font-semibold uppercase">
                          {dayName.format(asDate(candidate.date))}
                        </span>
                        <span className="text-[15px] font-semibold">
                          {dayNumber.format(asDate(candidate.date))}
                        </span>
                        <span className="sr-only">{open ? "" : " (full)"}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              {day ? (
                <fieldset className="mt-5">
                  <legend className="mb-2 text-[15px] font-semibold">
                    {longDay.format(asDate(day.date))}
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {day.windows.map((window) => (
                      <label
                        key={window.startMinute}
                        className={cn(
                          "flex min-h-12 cursor-pointer items-center gap-2.5 rounded-input border px-3.5 py-2 text-[15px] font-semibold transition-colors",
                          !window.available && "cursor-not-allowed opacity-45",
                          windowStart === window.startMinute
                            ? "border-primary bg-primary-soft"
                            : "border-border hover:border-field",
                        )}
                      >
                        <input
                          type="radio"
                          name="window"
                          value={window.startMinute}
                          disabled={!window.available}
                          checked={windowStart === window.startMinute}
                          onChange={() => setWindowStart(window.startMinute)}
                          className="size-4 accent-primary"
                        />
                        {window.label}
                        {window.available ? null : (
                          <span className="ml-auto text-sm font-medium text-muted">Full</span>
                        )}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : data &&
                !data.days.some((candidate) =>
                  candidate.windows.some((window) => window.available),
                ) ? (
                <p className="mt-4 text-[15px] text-muted">
                  Nothing open these days. Try later dates.
                </p>
              ) : null}
            </>
          )}
        </Card>

        <Card as="section" aria-labelledby="where-title">
          <h2 id="where-title" className="font-display text-[20px] font-bold">
            Where
          </h2>
          <p className="mt-1 text-[15px] text-muted">
            The pro sees the address once the booking is paid.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="Street address"
              error={fieldErrors?.address?.[0]}
              className="sm:col-span-2"
            >
              <Input
                autoComplete="address-line1"
                value={address.line1}
                maxLength={120}
                onChange={(event) =>
                  setAddress((current) => ({ ...current, line1: event.target.value }))
                }
              />
            </Field>
            <Field label="Apartment or unit (optional)">
              <Input
                autoComplete="address-line2"
                value={address.line2}
                maxLength={120}
                onChange={(event) =>
                  setAddress((current) => ({ ...current, line2: event.target.value }))
                }
              />
            </Field>
            <Field label="Town or city">
              <Input
                autoComplete="address-level2"
                value={address.city}
                maxLength={80}
                onChange={(event) =>
                  setAddress((current) => ({ ...current, city: event.target.value }))
                }
              />
            </Field>
            <Field label="Postal code" hint="Nova Scotia only (starts with B).">
              <Input
                autoComplete="postal-code"
                autoCapitalize="characters"
                className="uppercase"
                maxLength={7}
                value={address.postalCode}
                onChange={(event) =>
                  setAddress((current) => ({ ...current, postalCode: event.target.value }))
                }
              />
            </Field>
            <Field
              label="Notes for the pro (optional)"
              hint="Gate codes, pets, where to park."
              className="sm:col-span-2"
            >
              <Textarea
                rows={3}
                maxLength={500}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
          </div>
        </Card>
      </div>

      <aside className="lg:sticky lg:top-24" aria-label="Summary">
        <Card>
          <h2 className="font-display text-[20px] font-bold">Summary</h2>
          {data ? (
            <>
              <p className="mt-2 text-[15px] font-semibold">{data.service.title}</p>
              <p className="text-sm text-muted">
                About {data.service.duration}
                {day && chosenWindow
                  ? ` · ${longDay.format(asDate(day.date))}, ${chosenWindow.label}`
                  : ""}
              </p>
              <dl className="mt-4 grid gap-1.5 text-[15px]">
                <div className="flex justify-between">
                  <dt>Job price</dt>
                  <dd>{formatCad(data.price.priceCents)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Service fee</dt>
                  <dd>{formatCad(data.price.serviceFeeCents)}</dd>
                </div>
                {data.price.taxCents > 0 ? (
                  <div className="flex justify-between">
                    <dt>HST</dt>
                    <dd>{formatCad(data.price.taxCents)}</dd>
                  </div>
                ) : null}
                <div className="mt-1 flex justify-between border-t border-border pt-2 font-semibold">
                  <dt>Total</dt>
                  <dd>{formatCad(data.price.totalCents)}</dd>
                </div>
              </dl>
              <div className="mt-4 grid gap-2 text-sm text-muted">
                {data.instantBook ? (
                  <p className="flex items-start gap-2">
                    <Badge variant="instant" /> Confirmed as soon as you pay.
                  </p>
                ) : (
                  <p>
                    <strong className="text-ink">Needs the pro&apos;s OK.</strong> Your card is
                    held, not charged, until they accept (within 24 hours). If they don&apos;t, the
                    hold is released.
                  </p>
                )}
                <p>
                  <strong className="text-ink">
                    {data.cancellationPolicy.label} cancellation.
                  </strong>{" "}
                  {data.cancellationPolicy.description} The service fee isn&apos;t refunded when you
                  cancel.
                </p>
              </div>
            </>
          ) : (
            <Skeleton className="mt-4 h-40" />
          )}
          {problem || (checkout.error && !fieldErrors) ? (
            <FormAlert tone="error" className="mt-4">
              {problem ?? checkout.error?.message}
            </FormAlert>
          ) : null}
          <Button
            type="submit"
            size="lg"
            block
            className="mt-5"
            disabled={checkout.isPending || checkout.isSuccess || !data}
            aria-busy={checkout.isPending}
          >
            <LockIcon size={18} />
            {checkout.isPending || checkout.isSuccess
              ? "Opening secure payment…"
              : "Continue to payment"}
            <ArrowRightIcon size={18} />
          </Button>
          <p className="mt-2 text-center text-xs text-muted">
            You&apos;ll pay on a secure payment page. Nevile never sees your card number.
          </p>
        </Card>
      </aside>
    </form>
  );
}
