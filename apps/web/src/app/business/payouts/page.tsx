import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui/container.tsx";
import { VerificationRequired } from "@/components/verification/verification-required.tsx";
import { BusinessNav } from "../business-nav.tsx";
import { currentBusiness } from "../current-business.ts";
import { PayoutsView } from "./payouts-view.tsx";

export const metadata: Metadata = { title: "Payouts", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Payout setup and history (SPEC §7, §19). Owners and managers only. */
export default async function PayoutsPage({ searchParams }: Props) {
  const params = await searchParams;
  const { verified, email, businesses, selected } = await currentBusiness(
    "/business/payouts",
    params,
  );
  if (!verified || !selected) {
    return (
      <Container className="pt-1 pb-16">
        <VerificationRequired className="max-w-xl" action="set up payouts" email={email} />
      </Container>
    );
  }
  if (selected.role === "crew") redirect(`/business/calendar?b=${selected.id}`);
  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <BusinessNav
        current="/business/payouts"
        businessId={selected.id}
        businesses={businesses}
        role={selected.role}
      />
      <PayoutsView
        key={selected.id}
        businessId={selected.id}
        isOwner={selected.role === "owner"}
        returned={params.done === "1"}
      />
    </Container>
  );
}
