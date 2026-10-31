import type { Metadata } from "next";
import { Container } from "@/components/ui/container.tsx";
import { VerificationRequired } from "@/components/verification/verification-required.tsx";
import { BusinessNav } from "../../business-nav.tsx";
import { currentBusiness } from "../../current-business.ts";
import { OngoingManager } from "./ongoing-manager.tsx";

export const metadata: Metadata = {
  title: "Recurring job",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** A recurring series or snow contract, with all its visits (SPEC §21). */
export default async function BusinessBookingPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { verified, email, businesses, selected } = await currentBusiness(
    `/business/bookings/${id}`,
    await searchParams,
  );
  if (!verified || !selected) {
    return (
      <Container className="pt-1 pb-16">
        <VerificationRequired className="max-w-xl" action="see this job" email={email} />
      </Container>
    );
  }
  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <BusinessNav
        current="/business/calendar"
        businessId={selected.id}
        businesses={businesses}
        role={selected.role}
      />
      <OngoingManager
        businessId={selected.id}
        bookingId={id}
        canManage={selected.role !== "crew"}
      />
    </Container>
  );
}
