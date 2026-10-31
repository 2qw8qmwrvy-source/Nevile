import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Container } from "@/components/ui/container.tsx";
import { VerificationRequired } from "@/components/verification/verification-required.tsx";
import { BusinessNav } from "../../business-nav.tsx";
import { currentBusiness } from "../../current-business.ts";
import { QuoteReply } from "./quote-reply.tsx";

export const metadata: Metadata = {
  title: "Quote request",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function QuoteRequestPage({ params, searchParams }: Props) {
  const { requestId } = await params;
  const { caller, verified, email, businesses, selected } = await currentBusiness(
    `/business/quotes/${requestId}`,
    await searchParams,
  );
  if (!verified || !selected) {
    return (
      <Container className="pt-1 pb-16">
        <VerificationRequired className="max-w-xl" action="answer quote requests" email={email} />
      </Container>
    );
  }
  if (selected.role === "crew") redirect(`/business/calendar?b=${selected.id}`);
  const request = await caller.businessQuotes
    .get({ businessId: selected.id, requestId })
    .catch((error: unknown) => {
      if (
        error instanceof TRPCError &&
        (error.code === "NOT_FOUND" || error.code === "BAD_REQUEST")
      )
        notFound();
      throw error;
    });
  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <BusinessNav
        current="/business/quotes"
        businessId={selected.id}
        businesses={businesses}
        role={selected.role}
      />
      <QuoteReply businessId={selected.id} initial={request} />
    </Container>
  );
}
