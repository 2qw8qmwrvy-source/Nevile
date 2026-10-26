import { contactEmail } from "@nevile/auth/client";
import { TRPCError } from "@trpc/server";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { BookingFlow } from "@/app/pros/[slug]/book/booking-flow.tsx";
import { ContractFlow } from "@/components/booking/contract-flow.tsx";
import { RecurringFlow } from "@/components/booking/recurring-flow.tsx";
import { Container } from "@/components/ui/container.tsx";
import { VerificationRequired } from "@/components/verification/verification-required.tsx";
import { getSession } from "@/lib/auth.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";

export const metadata: Metadata = { title: "Book a quote", robots: { index: false } };

type Props = {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Booking a quote (SPEC §20, §21): a one-off price is booked and paid like a job; a
 * recurring offer on one of its schedules; snow contract terms are signed up for.
 */
export default async function BookQuotePage({ params, searchParams }: Props) {
  const { groupId } = await params;
  const { quote, card } = await searchParams;
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
      <p className="text-sm font-semibold tracking-[0.06em] text-primary uppercase">
        {"problem" in options
          ? "Book a quote"
          : options.quote?.kind === "recurring"
            ? "Recurring visits"
            : options.quote?.kind === "snow_contract"
              ? "Snow contract"
              : "Book a quote"}
      </p>
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
          {card === "saved" ? (
            <FormAlert tone="success" className="mt-4 max-w-xl">
              Card saved. You can finish booking now.
            </FormAlert>
          ) : null}
          <p className="mt-2 text-[16px] text-muted">
            The job address must be in {options.postalArea}, the area you asked about.
          </p>
          {options.quote?.kind === "recurring" ? (
            <RecurringFlow
              source={{ kind: "quote", quoteId }}
              defaultPostal={me.onboarding.postalCode ?? ""}
              returnPath={here}
            />
          ) : options.quote?.kind === "snow_contract" ? (
            <ContractFlow
              source={{ kind: "quote", quoteId }}
              defaultPostal={me.onboarding.postalCode ?? ""}
              returnPath={here}
            />
          ) : (
            <BookingFlow
              source={{ kind: "quote", quoteId }}
              defaultPostal={me.onboarding.postalCode ?? ""}
            />
          )}
        </>
      )}
    </Container>
  );
}
