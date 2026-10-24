import { contactEmail } from "@nevile/auth/client";
import { isCategorySlug } from "@nevile/core";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui/container.tsx";
import { VerificationRequired } from "@/components/verification/verification-required.tsx";
import { getSession } from "@/lib/auth.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";
import { QuoteRequestForm } from "./quote-request-form.tsx";

export const metadata: Metadata = { title: "Ask for a quote", robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ask up to 3 pros for a quote with one request (SPEC §20). */
export default async function NewQuotePage({ searchParams }: Props) {
  const query = await searchParams;
  const text = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : "");
  const pros = [...new Set(`${text("pros")},${text("pro")}`.split(","))]
    .filter((id) => UUID.test(id))
    .slice(0, 3);
  const category = isCategorySlug(text("category")) ? text("category") : "";
  const here = `/quotes/new?${new URLSearchParams({ category, postal: text("postal"), pros: pros.join(",") })}`;
  if (!(await getSession())) redirect(`/sign-in?next=${encodeURIComponent(here)}`);
  const caller = await getServerCaller();
  const me = await caller.me.get();
  const categories = await caller.categories.list();

  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <p className="text-sm font-semibold tracking-[0.06em] text-primary uppercase">Quotes</p>
      <h1 className="mt-1 font-display text-[30px] leading-[1.1] font-extrabold tracking-[-0.03em] sm:text-[38px]">
        Ask for a quote
      </h1>
      <p className="mt-2 max-w-2xl text-[16px] text-muted">
        Describe the job once and up to 3 pros will reply with a price, usually within a day. You
        only share your street address when you book.
      </p>
      {me.verified ? (
        <QuoteRequestForm
          categories={categories.map(({ slug, name }) => ({ slug, name }))}
          initialCategory={category || (categories[0]?.slug ?? "")}
          initialPostal={text("postal") || me.onboarding.postalCode || ""}
          initialPros={pros}
        />
      ) : (
        <VerificationRequired
          className="mt-6 max-w-xl"
          action="ask for quotes"
          email={contactEmail(me.user.email)}
        />
      )}
    </Container>
  );
}
