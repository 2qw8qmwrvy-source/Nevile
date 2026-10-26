import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button.tsx";
import { Container } from "@/components/ui/container.tsx";
import { fakePayments } from "@/lib/booking-deps.ts";

export const metadata: Metadata = {
  title: "Test card",
  robots: { index: false, follow: false },
};

/**
 * Stand-in for Stripe's card-saving page in development and tests (SPEC §21). No card is
 * entered and no money moves; production never serves it.
 */
export default async function FakeCardPage({ params }: { params: Promise<{ id: string }> }) {
  const fake = fakePayments();
  if (!fake) notFound();
  const { id } = await params;
  const setupId = decodeURIComponent(id);
  const setup = fake.describeCardSetup(setupId);
  if (!setup || setup.kind !== "page") notFound();
  return (
    <Container className="pt-1 pb-16">
      <section
        aria-labelledby="fake-title"
        className="mx-auto max-w-md rounded-panel border-2 border-dashed border-season bg-surface p-6"
      >
        <p className="text-xs font-semibold tracking-[0.08em] text-season-ink uppercase">
          Test mode: no real money
        </p>
        <h1 id="fake-title" className="mt-2 font-display text-[26px] font-bold">
          Save a test card
        </h1>
        <p className="mt-1 text-sm text-muted">
          Saves a card for recurring visits and snow contracts. Nothing is charged now.
        </p>
        {setup.status === "open" ? (
          <form method="post" action="/api/dev/fake-card" className="mt-6 grid gap-3">
            <input type="hidden" name="setupId" value={setupId} />
            <Button type="submit" size="lg" block name="declining" value="false">
              Save test card
            </Button>
            <Button type="submit" variant="secondary" block name="declining" value="true">
              Save a card that declines
            </Button>
            {setup.cancelUrl ? (
              <Button href={setup.cancelUrl as Route} variant="ghost" block>
                Cancel
              </Button>
            ) : null}
          </form>
        ) : (
          <p className="mt-6 text-[15px]">This card form is {setup.status}.</p>
        )}
      </section>
    </Container>
  );
}
