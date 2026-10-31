import type { Metadata } from "next";
import { Container } from "@/components/ui/container.tsx";
import { VerificationRequired } from "@/components/verification/verification-required.tsx";
import { BusinessNav } from "../business-nav.tsx";
import { currentBusiness } from "../current-business.ts";
import { CalendarView } from "./calendar-view.tsx";

export const metadata: Metadata = { title: "Calendar", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The business calendar (SPEC §19): requests, jobs by day and window, crew assignment. */
export default async function CalendarPage({ searchParams }: Props) {
  const { verified, email, businesses, selected } = await currentBusiness(
    "/business/calendar",
    await searchParams,
  );
  if (!verified || !selected) {
    return (
      <Container className="pt-1 pb-16">
        <VerificationRequired className="max-w-xl" action="see your calendar" email={email} />
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
      <CalendarView
        key={selected.id}
        businessId={selected.id}
        canManage={selected.role !== "crew"}
      />
    </Container>
  );
}
