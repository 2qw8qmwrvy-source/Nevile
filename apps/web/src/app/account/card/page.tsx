import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Container } from "@/components/ui/container.tsx";
import { getSession } from "@/lib/auth.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";
import { CardSetupButton } from "./card-setup-button.tsx";

export const metadata: Metadata = {
  title: "Payment method",
  robots: { index: false, follow: false },
};

/** Only paths on this site come back here (`?next=`). */
const LOCAL_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/;

type CardPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Account → Payment method (SPEC §21): the one saved card recurring jobs and snow
 * contracts charge. Replacing it moves every ongoing booking to the new card.
 */
export default async function CardPage({ searchParams }: CardPageProps) {
  const query = await searchParams;
  const next = typeof query.next === "string" && LOCAL_PATH.test(query.next) ? query.next : null;
  const here = `/account/card${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  if (!(await getSession())) redirect(`/sign-in?next=${encodeURIComponent(here)}`);
  const card = await (await getServerCaller()).cards.get();
  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <Link
        href={(next ?? "/account") as Route}
        className="inline-flex min-h-11 items-center text-[15px] font-semibold text-primary"
      >
        ← {next ? "Back" : "Your account"}
      </Link>
      <h1 className="font-display text-[30px] leading-[1.1] font-extrabold tracking-[-0.03em] sm:text-[36px]">
        Payment method
      </h1>
      <p className="mt-2 max-w-[38em] text-[16px] text-muted">
        Recurring visits and snow contracts are charged to this card as each charge comes due.
        One-off jobs are paid when you book.
      </p>
      {query.saved ? (
        <FormAlert tone="success" className="mt-5 max-w-xl">
          Card saved. Your recurring visits and contracts use it from now on.
        </FormAlert>
      ) : null}
      <Card as="section" aria-labelledby="card-title" className="mt-6 max-w-xl">
        <h2 id="card-title" className="font-display text-[20px] font-bold">
          Saved card
        </h2>
        {card ? (
          <p className="mt-3 text-[16px]">
            <span className="font-semibold">{card.label}</span>
            <span className="text-muted"> · expires {card.expires}</span>
          </p>
        ) : (
          <p className="mt-3 text-[15px] text-muted">No card saved yet.</p>
        )}
        <div className="mt-5">
          <CardSetupButton returnPath={next} label={card ? "Replace card" : "Add a card"} />
        </div>
        <p className="mt-3 text-sm text-muted">
          You&apos;ll enter it on a secure payment page. Nevile never sees your card number; we keep
          only the brand, last 4 digits and expiry.
        </p>
      </Card>
    </Container>
  );
}
