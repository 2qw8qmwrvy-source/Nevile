import type { Metadata } from "next";
import { Container } from "@/components/ui/container.tsx";
import { VerificationRequired } from "@/components/verification/verification-required.tsx";
import { BusinessNav } from "../business-nav.tsx";
import { currentBusiness } from "../current-business.ts";
import { TeamView } from "./team-view.tsx";

export const metadata: Metadata = { title: "Team", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Team hours, time off, invites and booking windows (SPEC §19). */
export default async function TeamPage({ searchParams }: Props) {
  const { verified, email, businesses, selected } = await currentBusiness(
    "/business/team",
    await searchParams,
  );
  if (!verified || !selected) {
    return (
      <Container className="pt-1 pb-16">
        <VerificationRequired className="max-w-xl" action="manage your team" email={email} />
      </Container>
    );
  }
  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <BusinessNav
        current="/business/team"
        businessId={selected.id}
        businesses={businesses}
        role={selected.role}
      />
      <TeamView key={selected.id} businessId={selected.id} role={selected.role} />
    </Container>
  );
}
