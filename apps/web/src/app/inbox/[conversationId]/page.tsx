import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Container } from "@/components/ui/container.tsx";
import { getSession } from "@/lib/auth.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";
import { ChatThread } from "./chat-thread.tsx";

export const metadata: Metadata = { title: "Conversation", robots: { index: false } };

type Props = { params: Promise<{ conversationId: string }> };

export default async function ConversationPage({ params }: Props) {
  const { conversationId } = await params;
  if (!(await getSession()))
    redirect(`/sign-in?next=${encodeURIComponent(`/inbox/${conversationId}`)}`);
  const caller = await getServerCaller();
  const thread = await caller.chat.thread({ conversationId }).catch((error: unknown) => {
    if (error instanceof TRPCError && (error.code === "NOT_FOUND" || error.code === "BAD_REQUEST"))
      notFound();
    throw error;
  });
  const { verified } = await caller.me.get();
  return (
    <Container className="max-w-3xl pt-1 pb-6">
      <ChatThread initial={thread} canSend={verified} />
    </Container>
  );
}
