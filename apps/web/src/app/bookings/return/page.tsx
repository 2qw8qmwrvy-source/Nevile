import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui/container.tsx";
import { getSession } from "@/lib/auth.ts";
import { CheckoutReturn } from "./checkout-return.tsx";

export const metadata: Metadata = { title: "Finishing your booking", robots: { index: false } };

type ReturnPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Where the payment page sends customers back to (SPEC §19). */
export default async function ReturnPage({ searchParams }: ReturnPageProps) {
  const { session } = await searchParams;
  const sessionId = typeof session === "string" ? session : "";
  if (!(await getSession())) {
    redirect(`/sign-in?next=${encodeURIComponent(`/bookings/return?session=${sessionId}`)}`);
  }
  return (
    <Container className="pt-1 pb-16">
      <CheckoutReturn sessionId={sessionId} />
    </Container>
  );
}
