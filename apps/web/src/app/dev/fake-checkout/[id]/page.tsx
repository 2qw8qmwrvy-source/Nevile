import { formatCad } from "@nevile/core";
import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button.tsx";
import { Container } from "@/components/ui/container.tsx";
import { fakePayments } from "@/lib/booking-deps.ts";

export const metadata: Metadata = {
  title: "Test payment",
  robots: { index: false, follow: false },
};

/**
 * Stand-in for Stripe's checkout page in development and tests (SPEC §19). No card is
 * entered and no money moves; production never serves it.
 */
export default async function FakeCheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const fake = fakePayments();
  if (!fake) notFound();
  const { id } = await params;
  const sessionId = decodeURIComponent(id);
  const checkout = fake.describeCheckout(sessionId);
  if (!checkout) notFound();
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
          Test payment
        </h1>
        <p className="mt-1 text-sm text-muted">{checkout.description}</p>
        <dl className="mt-4 grid gap-1.5 text-[15px]">
          {checkout.lines.map((line) => (
            <div key={line.name} className="flex justify-between gap-3">
              <dt className="min-w-0">{line.name}</dt>
              <dd>{formatCad(line.amountCents)}</dd>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t border-border pt-2 font-semibold">
            <dt>{checkout.capture === "hold" ? "Hold on card" : "Total"}</dt>
            <dd>{formatCad(checkout.amountCents)}</dd>
          </div>
        </dl>
        {checkout.status === "open" ? (
          <form method="post" action="/api/dev/fake-checkout" className="mt-6 grid gap-3">
            <input type="hidden" name="sessionId" value={sessionId} />
            <Button type="submit" size="lg" block>
              {checkout.capture === "hold" ? "Authorize test card" : "Pay with test card"}
            </Button>
            <Button href={checkout.cancelUrl as Route} variant="ghost" block>
              Cancel
            </Button>
          </form>
        ) : (
          <p className="mt-6 text-[15px]">This checkout is {checkout.status}.</p>
        )}
      </section>
    </Container>
  );
}
