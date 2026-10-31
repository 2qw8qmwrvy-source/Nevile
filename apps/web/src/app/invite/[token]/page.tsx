import type { Metadata, Route } from "next";
import { Button } from "@/components/ui/button.tsx";
import { Container } from "@/components/ui/container.tsx";
import { getSessionOrNull } from "@/lib/auth.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";
import { AcceptInvite } from "./accept-invite.tsx";

export const metadata: Metadata = { title: "Join a team", robots: { index: false, follow: false } };

/** A crew invite link (SPEC §19): sign in with the invited email, then accept. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const caller = await getServerCaller();
  const info = await caller.team.inviteInfo({ token }).catch(() => ({ valid: false as const }));
  const signedIn = (await getSessionOrNull()) !== null;
  const next = encodeURIComponent(`/invite/${token}`);
  return (
    <Container className="pt-1 pb-16">
      <section className="mx-auto max-w-lg rounded-panel bg-primary-soft px-6 py-10 text-center">
        {info.valid ? (
          <>
            <h1 className="font-display text-[28px] font-bold">Join {info.businessName}</h1>
            <p className="mt-2 text-muted">
              You&apos;ve been invited as {info.roleLabel.toLowerCase()}. Use the email address the
              invite was sent to.
            </p>
            {signedIn ? (
              <AcceptInvite token={token} />
            ) : (
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button href={`/sign-in?next=${next}` as Route}>Sign in to accept</Button>
                <Button href={`/sign-up?next=${next}` as Route} variant="secondary">
                  Create an account
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <h1 className="font-display text-[28px] font-bold">
              This invite doesn&apos;t work any more
            </h1>
            <p className="mt-2 text-muted">It may have expired or been used. Ask for a new one.</p>
          </>
        )}
      </section>
    </Container>
  );
}
