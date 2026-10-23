import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button.tsx";
import { Container } from "@/components/ui/container.tsx";
import { fakePayments } from "@/lib/booking-deps.ts";

export const metadata: Metadata = {
  title: "Test payout setup",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Stand-in for Stripe's payout setup in development and tests. */
export default async function FakeOnboardingPage({ searchParams }: Props) {
  if (!fakePayments()) notFound();
  const query = await searchParams;
  const accountId = typeof query.account === "string" ? query.account : "";
  const returnUrl = typeof query.return === "string" ? query.return : "/business/payouts";
  return (
    <Container className="pt-1 pb-16">
      <section className="mx-auto max-w-md rounded-panel border-2 border-dashed border-season bg-surface p-6">
        <p className="text-xs font-semibold tracking-[0.08em] text-season-ink uppercase">
          Test mode
        </p>
        <h1 className="mt-2 font-display text-[26px] font-bold">Test payout setup</h1>
        <p className="mt-2 text-[15px] text-muted">
          In production this is Stripe&apos;s secure form for your ID and bank account.
        </p>
        <form method="post" action="/api/dev/fake-onboarding" className="mt-6">
          <input type="hidden" name="accountId" value={accountId} />
          <input type="hidden" name="returnUrl" value={returnUrl} />
          <Button type="submit" size="lg" block>
            Finish test setup
          </Button>
        </form>
      </section>
    </Container>
  );
}
