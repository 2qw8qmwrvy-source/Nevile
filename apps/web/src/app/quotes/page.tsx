import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Container } from "@/components/ui/container.tsx";
import { getSession } from "@/lib/auth.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";

export const metadata: Metadata = { title: "Your quotes", robots: { index: false } };

const dateLabel = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Halifax",
  month: "long",
  day: "numeric",
});

/** A customer's quote requests and the quotes on them (SPEC §20). */
export default async function QuotesPage() {
  if (!(await getSession())) redirect("/sign-in?next=%2Fquotes");
  const caller = await getServerCaller();
  const groups = await caller.quotes.list();
  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-[30px] leading-[1.1] font-extrabold tracking-[-0.03em] sm:text-[38px]">
          Your quotes
        </h1>
        <Button href="/search" variant="secondary">
          Find pros to ask
        </Button>
      </div>
      {groups.length === 0 ? (
        <Card className="mt-6 max-w-xl">
          <h2 className="font-display text-[20px] font-bold">No quote requests yet</h2>
          <p className="mt-1 text-[15px] text-muted">
            For bigger or unusual jobs, search for pros and ask up to 3 for a price.
          </p>
        </Card>
      ) : (
        <ul className="mt-6 grid gap-3">
          {groups.map((group) => (
            <li key={group.id}>
              <Link
                href={`/quotes/${group.id}` as Route}
                className="block rounded-card border border-border bg-surface p-4 text-ink no-underline shadow-card hover:border-field sm:p-5"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[17px] font-semibold">{group.category.name}</span>
                  <span className="text-sm text-muted">
                    Asked {dateLabel.format(group.createdAt)}
                  </span>
                </span>
                <span className="mt-1 line-clamp-2 block text-[15px] text-muted">
                  {group.details}
                </span>
                <span className="mt-2 block text-sm font-semibold text-primary">
                  {group.summary}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
