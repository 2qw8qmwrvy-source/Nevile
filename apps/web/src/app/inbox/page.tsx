import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui/container.tsx";
import { getSession } from "@/lib/auth.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";
import { InboxView } from "./inbox-view.tsx";

export const metadata: Metadata = { title: "Inbox", robots: { index: false } };

/** Conversations and updates (SPEC §20): as a customer, and for each business you run. */
export default async function InboxPage() {
  if (!(await getSession())) redirect("/sign-in?next=%2Finbox");
  const caller = await getServerCaller();
  const { businesses } = await caller.me.get();
  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <h1 className="font-display text-[30px] leading-[1.1] font-extrabold tracking-[-0.03em] sm:text-[38px]">
        Inbox
      </h1>
      <InboxView
        businesses={businesses
          .filter(({ role }) => role !== "crew")
          .map(({ business }) => ({ id: business.id, name: business.name }))}
      />
    </Container>
  );
}
