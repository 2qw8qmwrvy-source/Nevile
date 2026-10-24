import { contactEmail } from "@nevile/auth/client";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Container } from "@/components/ui/container.tsx";
import { VerificationRequired } from "@/components/verification/verification-required.tsx";
import { getSession } from "@/lib/auth.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";
import { BookingFlow } from "./booking-flow.tsx";

export const metadata: Metadata = { title: "Book", robots: { index: false } };

type BookPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Booking a fixed-price service (SPEC §19). Signed-in, verified customers only. */
export default async function BookPage({ params, searchParams }: BookPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const requested = typeof query.service === "string" ? query.service : undefined;
  const here = `/pros/${slug}/book${requested ? `?service=${requested}` : ""}`;
  if (!(await getSession())) redirect(`/sign-in?next=${encodeURIComponent(here)}`);

  const caller = await getServerCaller();
  const profile = await caller.search.profile({ slug }).catch((error: unknown) => {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const bookable = profile.services.filter((service) => service.bookable);
  if (bookable.length === 0) notFound();
  const me = await caller.me.get();

  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <p className="text-sm font-semibold tracking-[0.06em] text-primary uppercase">Book</p>
      <h1 className="mt-1 font-display text-[30px] leading-[1.1] font-extrabold tracking-[-0.03em] break-words sm:text-[38px]">
        {profile.name}
      </h1>
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
        <BookingFlow
          source={{
            kind: "service",
            services: bookable.map((service) => ({
              id: service.id,
              title: service.title,
              priceText: service.priceText,
            })),
            initialServiceId: bookable.some((service) => service.id === requested)
              ? (requested as string)
              : (bookable[0]?.id ?? ""),
          }}
          defaultPostal={me.onboarding.postalCode ?? ""}
        />
      )}
    </Container>
  );
}
