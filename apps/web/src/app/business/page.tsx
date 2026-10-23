import { contactEmail } from "@nevile/auth/client";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui/container.tsx";
import { VerificationRequired } from "@/components/verification/verification-required.tsx";
import { getSession } from "@/lib/auth.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";
import { ListingDashboard } from "./listing-dashboard.tsx";

export const metadata: Metadata = {
  title: "Your listing",
  robots: { index: false, follow: false },
};

type BusinessPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Business mode on the website (SPEC §18): manage the listing customers find in search. */
export default async function BusinessPage({ searchParams }: BusinessPageProps) {
  if (!(await getSession())) redirect("/sign-in?next=/business");
  const [{ b }, caller] = await Promise.all([searchParams, getServerCaller()]);
  const { user, businesses, verified } = await caller.me.get();

  if (!verified) {
    return (
      <Container className="pt-1 pb-16">
        <h1 className="font-display text-[32px] font-extrabold tracking-[-0.03em]">Your listing</h1>
        <VerificationRequired
          className="mt-5 max-w-xl"
          action="manage your business"
          email={contactEmail(user.email)}
        />
      </Container>
    );
  }
  if (businesses.length === 0) redirect("/account?intent=business");

  const selected = businesses.find(({ business }) => business.id === b) ?? businesses[0];
  if (!selected) redirect("/account?intent=business");

  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      {businesses.length > 1 ? (
        <nav aria-label="Your businesses" className="mb-4 flex flex-wrap gap-2">
          {businesses.map(({ business }) => (
            <Link
              key={business.id}
              href={`/business?b=${business.id}` as Route}
              aria-current={business.id === selected.business.id ? "page" : undefined}
              className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-[15px] font-semibold text-ink no-underline aria-[current=page]:border-primary aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary"
            >
              {business.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <ListingDashboard key={selected.business.id} businessId={selected.business.id} />
    </Container>
  );
}
