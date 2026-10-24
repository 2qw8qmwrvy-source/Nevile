import { contactEmail } from "@nevile/auth/client";
import { TRPCError } from "@trpc/server";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BookingFlow } from "@/app/pros/[slug]/book/booking-flow.tsx";
import { Container } from "@/components/ui/container.tsx";
import { VerificationRequired } from "@/components/verification/verification-required.tsx";
import { getSession } from "@/lib/auth.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";

export const metadata: Metadata = { title: "Book a quote", robots: { index: false } };

type Props = {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Booking an accepted quote: pick a window, enter the address, pay (SPEC §20). */
export default async function BookQuotePage({ params, searchParams }: Props) {
  const { groupId } = await params;
  const { quote } = await searchParams;
  const quoteId = typeof quote === "string" ? quote : "";
  const here = `/quotes/${groupId}/book?quote=${quoteId}`;
  if (!(await getSession())) redirect(`/sign-in?next=${encodeURIComponent(here)}`);
  const caller = await getServerCaller();
  const me = await caller.me.get();
  const options = await caller.quotes
    .bookingOptions({ quoteId, days: 7 })
    .catch((error: unknown) => {
      if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
      if (error instanceof TRPCError && error.code === "BAD_REQUEST")
        return { problem: error.message };
      throw error;
    });

  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <p className="text-sm font-semibold tracking-[0.06em] text-primary uppercase">Book a quote</p>
      <h1 className="mt-1 font-display text-[30px] leading-[1.1] font-extrabold tracking-[-0.03em] sm:text-[38px]">
        {"problem" in options ? "This quote can't be booked" : options.business.name}
      </h1>
      {"problem" in options ? (
        <p className="mt-4 max-w-xl text-[16px]">
          {options.problem}{" "}
          <Link href={`/quotes/${groupId}` as Route} className="font-semibold text-primary">
            Back to your quotes
          </Link>
        </p>
      ) : !me.verified ? (
        <VerificationRequired
          className="mt-6 max-w-xl"
          action="book"
          email={contactEmail(me.user.email)}
        />
      ) : !options.bookingOpen ? (
        <p className="mt-6 max-w-xl rounded-card border border-border bg-surface p-5 text-[15px]">
          {options.business.name} isn&apos;t taking new bookings right now.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[16px] text-muted">
            The job address must be in {options.postalArea}, the area you asked about.
          </p>
          <BookingFlow
            source={{ kind: "quote", quoteId }}
            defaultPostal={me.onboarding.postalCode ?? ""}
          />
        </>
      )}
    </Container>
  );
}
