import { contactEmail } from "@nevile/auth/client";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { ContractFlow } from "@/components/booking/contract-flow.tsx";
import { Container } from "@/components/ui/container.tsx";
import { VerificationRequired } from "@/components/verification/verification-required.tsx";
import { getSession } from "@/lib/auth.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";

export const metadata: Metadata = { title: "Snow contract", robots: { index: false } };

type ContractPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Signing up for a pro's seasonal snow contract (SPEC §21). */
export default async function ContractPage({ params, searchParams }: ContractPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const serviceId = typeof query.service === "string" ? query.service : "";
  const here = `/pros/${slug}/contract?service=${serviceId}`;
  if (!(await getSession())) redirect(`/sign-in?next=${encodeURIComponent(here)}`);

  const caller = await getServerCaller();
  const profile = await caller.search.profile({ slug }).catch((error: unknown) => {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const service = profile.services.find(
    (candidate) => candidate.id === serviceId && candidate.contract !== null,
  );
  if (!service) notFound();
  const me = await caller.me.get();

  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <p className="text-sm font-semibold tracking-[0.06em] text-primary uppercase">
        Snow contract
      </p>
      <h1 className="mt-1 font-display text-[30px] leading-[1.1] font-extrabold tracking-[-0.03em] break-words sm:text-[38px]">
        {service.title} with {profile.name}
      </h1>
      {query.card === "saved" ? (
        <FormAlert tone="success" className="mt-4 max-w-xl">
          Card saved. You can sign up now.
        </FormAlert>
      ) : null}
      {!me.verified ? (
        <VerificationRequired
          className="mt-6 max-w-xl"
          action="sign up"
          email={contactEmail(me.user.email)}
        />
      ) : (
        <ContractFlow
          source={{ kind: "service", serviceId: service.id }}
          defaultPostal={me.onboarding.postalCode ?? ""}
          returnPath={here}
        />
      )}
    </Container>
  );
}
