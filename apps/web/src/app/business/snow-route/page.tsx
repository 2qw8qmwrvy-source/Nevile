import type { Metadata } from "next";
import { Container } from "@/components/ui/container.tsx";
import { VerificationRequired } from "@/components/verification/verification-required.tsx";
import { BusinessNav } from "../business-nav.tsx";
import { currentBusiness } from "../current-business.ts";
import { SnowRoute } from "./snow-route.tsx";

export const metadata: Metadata = { title: "Snow route", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** After a storm: every active snow contract in route order, marked Cleared (SPEC §21). */
export default async function SnowRoutePage({ searchParams }: Props) {
  const { verified, email, businesses, selected } = await currentBusiness(
    "/business/snow-route",
    await searchParams,
  );
  if (!verified || !selected) {
    return (
      <Container className="pt-1 pb-16">
        <VerificationRequired className="max-w-xl" action="see your snow route" email={email} />
      </Container>
    );
  }
  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <BusinessNav
        current="/business/snow-route"
        businessId={selected.id}
        businesses={businesses}
        role={selected.role}
      />
      <SnowRoute key={selected.id} businessId={selected.id} canReorder={selected.role !== "crew"} />
    </Container>
  );
}
