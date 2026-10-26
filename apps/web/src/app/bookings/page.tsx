import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button.tsx";
import { Container } from "@/components/ui/container.tsx";
import { ArrowRightIcon } from "@/components/ui/icons.tsx";
import { getSession } from "@/lib/auth.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";
import { StatusPill } from "./status-pill.tsx";

export const metadata: Metadata = { title: "Your bookings", robots: { index: false } };

type View = Awaited<
  ReturnType<Awaited<ReturnType<typeof getServerCaller>>["bookings"]["list"]>
>["upcoming"][number];

function BookingRow({ booking }: { booking: View }) {
  return (
    <li>
      <Link
        href={`/bookings/${booking.id}` as Route}
        className="flex items-center gap-4 rounded-card border border-border bg-surface p-4 text-ink no-underline shadow-card hover:border-field hover:text-ink"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-semibold">{booking.service.title}</span>
          <span className="block text-sm text-muted">
            {booking.business.name} ·{" "}
            {booking.ongoing?.kind === "recurring"
              ? `${booking.ongoing.frequencyLabel}${
                  booking.ongoing.nextVisit
                    ? ` · next ${booking.ongoing.nextVisit.window.label}`
                    : ""
                }`
              : booking.ongoing?.kind === "snow_contract"
                ? `Snow contract · ${booking.ongoing.terms.season}`
                : booking.window.label}
          </span>
        </span>
        <StatusPill status={booking.status} label={booking.statusLabel} />
        <ArrowRightIcon size={18} className="flex-none text-muted" />
      </Link>
    </li>
  );
}

function Section({ title, bookings }: { title: string; bookings: View[] }) {
  if (bookings.length === 0) return null;
  return (
    <section className="mt-8" aria-label={title}>
      <h2 className="font-display text-[22px] font-bold tracking-[-0.02em]">{title}</h2>
      <ul className="mt-3 grid gap-3">
        {bookings.map((booking) => (
          <BookingRow key={booking.id} booking={booking} />
        ))}
      </ul>
    </section>
  );
}

/** A customer's bookings (SPEC §19): what needs them, what's coming, and the past. */
export default async function BookingsPage() {
  if (!(await getSession())) redirect("/sign-in?next=/bookings");
  const list = await (await getServerCaller()).bookings.list();
  const empty = list.needsYou.length + list.upcoming.length + list.past.length === 0;
  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <h1 className="font-display text-[32px] leading-[1.08] font-extrabold tracking-[-0.03em] sm:text-[40px]">
        Your bookings
      </h1>
      {empty ? (
        <div className="mt-6 rounded-panel border border-dashed border-field bg-surface px-5 py-10 text-center">
          <p className="text-[17px] font-semibold">No bookings yet</p>
          <p className="mt-1 text-muted">Find a local pro and book a time that suits you.</p>
          <Button className="mt-5" href="/search">
            Find a pro
          </Button>
        </div>
      ) : null}
      <Section title="Needs you" bookings={list.needsYou} />
      <Section title="Upcoming" bookings={list.upcoming} />
      <Section title="Past" bookings={list.past} />
    </Container>
  );
}
