import { formatCad } from "@nevile/core";
import { TRPCError } from "@trpc/server";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Container } from "@/components/ui/container.tsx";
import { getSession } from "@/lib/auth.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";
import { StatusPill } from "../status-pill.tsx";
import { BookingActions } from "./booking-actions.tsx";

export const metadata: Metadata = { title: "Booking", robots: { index: false } };

type BookingPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const dateTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Halifax",
  weekday: "long",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default async function BookingPage({ params, searchParams }: BookingPageProps) {
  const { id } = await params;
  const { new: isNew } = await searchParams;
  if (!(await getSession())) redirect(`/sign-in?next=${encodeURIComponent(`/bookings/${id}`)}`);
  const caller = await getServerCaller();
  const booking = await caller.bookings.get({ bookingId: id }).catch((error: unknown) => {
    if (error instanceof TRPCError && (error.code === "NOT_FOUND" || error.code === "BAD_REQUEST"))
      notFound();
    throw error;
  });
  const { amounts } = booking;
  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <Link
        href={"/bookings" as Route}
        className="inline-flex min-h-11 items-center text-[15px] font-semibold text-primary"
      >
        ← Your bookings
      </Link>
      {isNew ? (
        <FormAlert tone="success" className="mb-4">
          {booking.status === "requested"
            ? `Request sent. ${booking.business.name} has 24 hours to accept; your card is only held until then.`
            : "You're booked. We've emailed you a receipt."}
        </FormAlert>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[30px] leading-[1.1] font-extrabold tracking-[-0.03em] break-words sm:text-[36px]">
            {booking.service.title}
          </h1>
          <p className="mt-1 text-[16px] text-muted">
            with{" "}
            <Link
              href={`/pros/${booking.business.slug}` as Route}
              className="font-semibold text-primary"
            >
              {booking.business.name}
            </Link>
            {booking.conversationId ? (
              <>
                {" · "}
                <Link
                  href={`/inbox/${booking.conversationId}` as Route}
                  className="font-semibold text-primary"
                >
                  Message
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <StatusPill status={booking.status} label={booking.statusLabel} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="grid gap-5">
          <Card>
            <h2 className="font-display text-[20px] font-bold">When and where</h2>
            <p className="mt-2 text-[16px] font-semibold">{booking.window.label}</p>
            <p className="text-sm text-muted">The crew arrives during this window.</p>
            <address className="mt-3 text-[15px] not-italic">
              {booking.address.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
            {booking.notes ? (
              <p className="mt-3 text-[15px] whitespace-pre-line text-muted">“{booking.notes}”</p>
            ) : null}
            {booking.approvalExpiresAt ? (
              <p className="mt-3 text-sm text-muted">
                Waiting for {booking.business.name} until{" "}
                {dateTime.format(booking.approvalExpiresAt)}.
              </p>
            ) : null}
            {booking.cancellationReason ? (
              <p className="mt-3 text-[15px]">
                {booking.business.name} cancelled: “{booking.cancellationReason}”
              </p>
            ) : null}
            {booking.autoConfirmAt ? (
              <p className="mt-3 text-sm text-muted">
                Confirm or report a problem by {dateTime.format(booking.autoConfirmAt)}; after that
                it confirms automatically.
              </p>
            ) : null}
          </Card>
          <BookingActions booking={booking} />
        </div>
        <Card as="aside" aria-label="Payment">
          <h2 className="font-display text-[20px] font-bold">Payment</h2>
          <dl className="mt-3 grid gap-1.5 text-[15px]">
            <div className="flex justify-between">
              <dt>Job price</dt>
              <dd>{formatCad(amounts.priceCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Service fee</dt>
              <dd>{formatCad(amounts.serviceFeeCents)}</dd>
            </div>
            {amounts.taxCents > 0 ? (
              <div className="flex justify-between">
                <dt>HST</dt>
                <dd>{formatCad(amounts.taxCents)}</dd>
              </div>
            ) : null}
            <div className="mt-1 flex justify-between border-t border-border pt-2 font-semibold">
              <dt>{amounts.held ? "Held on your card" : "Total"}</dt>
              <dd>{formatCad(amounts.totalCents)}</dd>
            </div>
            {amounts.refundedCents > 0 ? (
              <div className="flex justify-between text-primary">
                <dt>Refunded</dt>
                <dd>{formatCad(amounts.refundedCents)}</dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-4 text-sm text-muted">
            <strong className="text-ink">{booking.cancellationPolicy.label} cancellation.</strong>{" "}
            {booking.cancellationPolicy.description}
          </p>
        </Card>
      </div>
    </Container>
  );
}
