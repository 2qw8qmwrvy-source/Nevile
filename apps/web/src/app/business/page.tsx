import type { Metadata } from "next";
import { Container } from "@/components/ui/container.tsx";
import { VerificationRequired } from "@/components/verification/verification-required.tsx";
import { BusinessNav } from "./business-nav.tsx";
import { currentBusiness } from "./current-business.ts";
import { ListingDashboard } from "./listing-dashboard.tsx";

export const metadata: Metadata = {
  title: "Your listing",
  robots: { index: false, follow: false },
};

type BusinessPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Business mode on the website (SPEC §18): manage the listing customers find in search. */
export default async function BusinessPage({ searchParams }: BusinessPageProps) {
  const { verified, email, businesses, selected } = await currentBusiness(
    "/business",
    await searchParams,
  );
  if (!verified || !selected) {
    return (
      <Container className="pt-1 pb-16">
        <h1 className="font-display text-[32px] font-extrabold tracking-[-0.03em]">Your listing</h1>
        <VerificationRequired
          className="mt-5 max-w-xl"
          action="manage your business"
          email={email}
        />
      </Container>
    );
  }
  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <BusinessNav
        current="/business"
        businessId={selected.id}
        businesses={businesses}
        role={selected.role}
      />
      <ListingDashboard key={selected.id} businessId={selected.id} />
    </Container>
  );
}
