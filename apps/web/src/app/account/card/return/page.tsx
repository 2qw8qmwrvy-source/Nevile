import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui/container.tsx";
import { getSession } from "@/lib/auth.ts";
import { CardReturn } from "./card-return.tsx";

export const metadata: Metadata = {
  title: "Saving your card",
  robots: { index: false, follow: false },
};

type ReturnPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Where the payment provider's card page comes back to (SPEC §21). */
export default async function CardReturnPage({ searchParams }: ReturnPageProps) {
  const { setup } = await searchParams;
  const setupId = typeof setup === "string" ? setup : "";
  if (!(await getSession())) {
    redirect(`/sign-in?next=${encodeURIComponent(`/account/card/return?setup=${setupId}`)}`);
  }
  return (
    <Container className="pt-6 pb-16">
      <CardReturn setupId={setupId} />
    </Container>
  );
}
