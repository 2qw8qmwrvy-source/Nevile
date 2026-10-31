import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui/container.tsx";
import { VerificationRequired } from "@/components/verification/verification-required.tsx";
import { BusinessNav } from "../business-nav.tsx";
import { currentBusiness } from "../current-business.ts";
import { QuoteInbox } from "./quote-inbox.tsx";

export const metadata: Metadata = {
  title: "Quote requests",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Quote requests to answer (SPEC §20). Owners and managers only. */
export default async function BusinessQuotesPage({ searchParams }: Props) {
  const { verified, email, businesses, selected } = await currentBusiness(
    "/business/quotes",
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
  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <BusinessNav
        current="/business/quotes"
        businessId={selected.id}
        businesses={businesses}
        role={selected.role}
      />
      <QuoteInbox key={selected.id} businessId={selected.id} />
    </Container>
  );
}
