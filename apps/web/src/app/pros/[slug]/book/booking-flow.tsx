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
import { asDate, DayWindowPicker, longDay } from "@/components/booking/day-window-picker.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Field, Input, Select, Textarea } from "@/components/ui/field.tsx";
import { ArrowRightIcon, LockIcon } from "@/components/ui/icons.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useTRPC } from "@/lib/trpc.ts";

/** What is being booked: one of a pro's fixed-price services, or an accepted quote. */
export type BookingSource =
  | {
      kind: "service";
      services: ReadonlyArray<{ id: string; title: string; priceText: string }>;
      initialServiceId: string;
    }
  | { kind: "quote"; quoteId: string };

type BookingFlowProps = {
  source: BookingSource;
  defaultPostal: string;
};

/** The parts of the page that differ between a service and a quote, in one shape. */
type BookingView = {
  title: string;
  duration: string;
  instantBook: boolean;
  cancellationPolicy: { label: string; description: string };
  price: { priceCents: number; serviceFeeCents: number; taxCents: number; totalCents: number };
  firstDate: string;
  lastDate: string;
  days: ReadonlyArray<{
    date: string;
    windows: ReadonlyArray<{ startMinute: number; label: string; available: boolean }>;
  }>;
};

const DAYS_PER_PAGE = 7;

/**
 * Pick a day and arrival window, enter the address, review the price, then pay on the
 * payment provider's page (SPEC §19). The server re-checks everything.
 */
export function BookingFlow({ source, defaultPostal }: BookingFlowProps) {
  const trpc = useTRPC();
  const services = source.kind === "service" ? source.services : [];
  const [serviceId, setServiceId] = useState(
    source.kind === "service" ? source.initialServiceId : "",
  );
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

  const serviceAvailability = useQuery({
    ...trpc.bookings.availability.queryOptions({ serviceId, from, days: DAYS_PER_PAGE }),
    enabled: source.kind === "service",
  });
  const quoteAvailability = useQuery({
    ...trpc.quotes.bookingOptions.queryOptions({
      quoteId: source.kind === "quote" ? source.quoteId : "",
      from,
      days: DAYS_PER_PAGE,
    }),
    enabled: source.kind === "quote",
  });
  const availability = source.kind === "service" ? serviceAvailability : quoteAvailability;
  const openPayment = { onSuccess: ({ url }: { url: string }) => window.location.assign(url) };
  const serviceCheckout = useMutation(trpc.bookings.checkout.mutationOptions(openPayment));
  const quoteCheckout = useMutation(trpc.quotes.checkout.mutationOptions(openPayment));
  const checkout = source.kind === "service" ? serviceCheckout : quoteCheckout;
  const data = toView(serviceAvailability.data, quoteAvailability.data, source.kind);
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
    if (source.kind === "quote") {
      quoteCheckout.mutate({ quoteId: source.quoteId, date, windowStart, address, notes });
    } else {
      serviceCheckout.mutate({ serviceId, date, windowStart, address, notes });
    }
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

        <DayWindowPicker
          title="When"
          hint="Pick a day, then the window when the crew can arrive."
          days={data?.days}
          loading={availability.isPending}
          error={availability.isError ? availability.error.message : null}
          date={date}
          windowStart={windowStart}
          onDate={(next) => {
            setDate(next);
            setWindowStart(null);
          }}
          onWindow={setWindowStart}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onPage={page}
        />

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
              <p className="mt-2 text-[15px] font-semibold">{data.title}</p>
              <p className="text-sm text-muted">
                About {data.duration}
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

type ServiceAvailability = {
  service: { title: string; duration: string };
  instantBook: boolean;
  cancellationPolicy: { label: string; description: string };
  price: BookingView["price"];
} & Pick<BookingView, "firstDate" | "lastDate" | "days">;

type QuoteAvailability = {
  title: string;
  cancellationPolicy: { label: string; description: string };
  quote: {
    priceCents: number;
    duration: string;
    total: { serviceFeeCents: number; taxCents: number; totalCents: number };
  } | null;
} & Pick<BookingView, "firstDate" | "lastDate" | "days">;

function toView(
  service: ServiceAvailability | undefined,
  quote: QuoteAvailability | undefined,
  kind: BookingSource["kind"],
): BookingView | undefined {
  if (kind === "service") {
    if (!service) return undefined;
    return {
      title: service.service.title,
      duration: service.service.duration,
      instantBook: service.instantBook,
      cancellationPolicy: service.cancellationPolicy,
      price: service.price,
      firstDate: service.firstDate,
      lastDate: service.lastDate,
      days: service.days,
    };
  }
  if (!quote?.quote) return undefined;
  return {
    title: quote.title,
    duration: quote.quote.duration,
    // The business already agreed to a quote: booking it is confirmed on payment.
    instantBook: true,
    cancellationPolicy: quote.cancellationPolicy,
    price: { priceCents: quote.quote.priceCents, ...quote.quote.total },
    firstDate: quote.firstDate,
    lastDate: quote.lastDate,
    days: quote.days,
  };
}
