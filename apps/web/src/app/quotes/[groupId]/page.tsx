import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Container } from "@/components/ui/container.tsx";
import { getSession } from "@/lib/auth.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";
import { QuoteGroupView } from "./quote-group-view.tsx";

export const metadata: Metadata = { title: "Quote request", robots: { index: false } };

type Props = {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function QuoteGroupPage({ params, searchParams }: Props) {
  const { groupId } = await params;
  const { new: isNew } = await searchParams;
  if (!(await getSession())) redirect(`/sign-in?next=${encodeURIComponent(`/quotes/${groupId}`)}`);
  const caller = await getServerCaller();
  const group = await caller.quotes.get({ groupId }).catch((error: unknown) => {
    if (error instanceof TRPCError && (error.code === "NOT_FOUND" || error.code === "BAD_REQUEST"))
      notFound();
    throw error;
  });
  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <QuoteGroupView initial={group} isNew={isNew === "1"} />
    </Container>
  );
}
