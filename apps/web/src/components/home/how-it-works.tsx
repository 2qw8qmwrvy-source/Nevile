import { calculateCharge, formatCad } from "@nevile/core";
import { Badge } from "@/components/ui/badge.tsx";
import { Card } from "@/components/ui/card.tsx";
import { DollarIcon, LockIcon } from "@/components/ui/icons.tsx";

const STEPS = [
  {
    title: "Find & compare",
    body: "Enter your address, then compare prices, reviews and next openings from businesses that serve your street.",
  },
  {
    title: "Book or request a quote",
    body: "Book a fixed price instantly, or request a quote and hear back within 24 hours.",
  },
  {
    title: "Pay securely & rate",
    body: "Pay in the app, confirm the job within 48 hours of completion, then rate it.",
  },
] as const;

/** Example job used to illustrate the checkout: $60.00, Ontario, GST/HST-registered business. */
const EXAMPLE_PRICE_CENTS = 6000;

export function HowItWorks() {
  const charge = calculateCharge({
    priceCents: EXAMPLE_PRICE_CENTS,
    province: "ON",
    businessTaxRegistered: true,
  });

  return (
    <section id="how" aria-labelledby="how-title" className="pt-14">
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-12">
        <div>
          <h2
            id="how-title"
            className="font-display text-[26px] leading-[1.15] font-bold tracking-[-0.02em] sm:text-[30px]"
          >
            How Nevile works
          </h2>
          <p className="mt-1.5 text-base text-muted">
            Book once or set it to repeat. The same three steps in every season.
          </p>
          <ol className="mt-5 border-b border-border">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4 border-t border-border py-4.5">
                <span
                  aria-hidden="true"
                  className="inline-flex size-10 flex-none items-center justify-center rounded-full bg-season-tint font-display text-lg font-bold text-season-ink transition-colors duration-300"
                >
                  {index + 1}
                </span>
                <div>
                  <h3 className="mt-1.5 mb-1 font-display text-[19px] leading-tight font-semibold">
                    <span className="sr-only">Step {index + 1}: </span>
                    {step.title}
                  </h3>
                  <p className="text-[15px] leading-[1.55] text-muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <Card as="aside" aria-labelledby="receipt-title" className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Example checkout</p>
            <Badge variant="verified" icon={null} className="h-7">
              Charged at booking
            </Badge>
          </div>
          <h3 id="receipt-title" className="mt-1.5 font-display text-xl leading-tight font-semibold">
            A one-off lawn mow in Ontario
          </h3>
          <p className="mt-1 text-sm text-muted">Flexible cancellation: free until 24h before the job</p>
          <dl className="mt-3.5 text-[15px] tabular-nums">
            <div className="flex justify-between gap-3 border-b border-border py-2">
              <dt>Lawn mowing (standard lot)</dt>
              <dd>{formatCad(charge.priceCents)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-b border-border py-2">
              <dt>Service fee</dt>
              <dd>{formatCad(charge.serviceFeeCents)}</dd>
            </div>
            {charge.taxLines.map((line) => (
              <div key={line.kind} className="flex justify-between gap-3 border-b border-border py-2">
                <dt>{line.label}</dt>
                <dd>{formatCad(line.amountCents)}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3 pt-3.5">
              <dt className="font-semibold">
                Total <span className="font-normal text-muted">(CAD)</span>
              </dt>
              <dd className="font-display text-2xl leading-none font-bold">
                {formatCad(charge.totalCents)}
              </dd>
            </div>
          </dl>
          <ul className="mt-4 grid gap-2 border-t border-border pt-3.5 text-sm leading-[1.45] text-muted">
            <li className="flex items-start gap-2.5">
              <DollarIcon size={18} className="mt-px flex-none text-primary" />
              <span>
                <strong className="text-ink">Tips are optional</strong> and go 100% to the business.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <LockIcon size={18} className="mt-px flex-none text-primary" />
              <span>
                <strong className="text-ink">Private until paid:</strong> phone and email unlock once
                you&apos;ve paid.
              </span>
            </li>
          </ul>
        </Card>
      </div>
    </section>
  );
}
