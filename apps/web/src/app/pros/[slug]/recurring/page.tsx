import { contactEmail } from "@nevile/auth/client";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { RecurringFlow } from "@/components/booking/recurring-flow.tsx";
import { Container } from "@/components/ui/container.tsx";
import { VerificationRequired } from "@/components/verification/verification-required.tsx";
import { getSession } from "@/lib/auth.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";

export const metadata: Metadata = { title: "Recurring visits", robots: { index: false } };

type RecurringPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Booking a fixed-price service as recurring visits (SPEC §21). */
export default async function RecurringPage({ params, searchParams }: RecurringPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const serviceId = typeof query.service === "string" ? query.service : "";
  const here = `/pros/${slug}/recurring?service=${serviceId}`;
  if (!(await getSession())) redirect(`/sign-in?next=${encodeURIComponent(here)}`);

  const caller = await getServerCaller();
  const profile = await caller.search.profile({ slug }).catch((error: unknown) => {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const service = profile.services.find(
    (candidate) =>
      candidate.id === serviceId &&
      candidate.bookable &&
      candidate.recurrenceFrequencies.length > 0,
  );
  if (!service) notFound();
  const me = await caller.me.get();

  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <p className="text-sm font-semibold tracking-[0.06em] text-primary uppercase">
        Recurring visits
      </p>
      <h1 className="mt-1 font-display text-[30px] leading-[1.1] font-extrabold tracking-[-0.03em] break-words sm:text-[38px]">
        {service.title} with {profile.name}
      </h1>
      {query.card === "saved" ? (
        <FormAlert tone="success" className="mt-4 max-w-xl">
          Card saved. Now pick your schedule.
        </FormAlert>
      ) : null}
      {!me.verified ? (
        <VerificationRequired
          className="mt-6 max-w-xl"
          action="book a pro"
          email={contactEmail(me.user.email)}
        />
      ) : !profile.bookingOpen ? (
        <p className="mt-6 max-w-xl rounded-card border border-border bg-surface p-5 text-[15px]">
          {profile.name} isn&apos;t taking new bookings right now. Please check back soon, or find
          another pro nearby.
        </p>
      ) : (
        <RecurringFlow
          source={{ kind: "service", serviceId: service.id }}
          defaultPostal={me.onboarding.postalCode ?? ""}
          returnPath={here}
        />
      )}
    </Container>
  );
}
