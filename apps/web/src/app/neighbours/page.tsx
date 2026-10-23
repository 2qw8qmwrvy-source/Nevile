import { calculateCharge, formatCad } from "@nevile/core";
import type { Metadata } from "next";
import Link from "next/link";
import { DonationPreview } from "@/components/neighbours/donation-preview.tsx";
import { LaunchStatus } from "@/components/neighbours/launch-status.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Container } from "@/components/ui/container.tsx";
import {
  ArrowRightIcon,
  HeartIcon,
  HomeIcon,
  ShieldIcon,
  UsersIcon,
} from "@/components/ui/icons.tsx";
import { getServerCaller } from "@/lib/trpc-server.ts";

export const metadata: Metadata = {
  title: "Nevile Neighbours",
  description:
    "We're setting aside donations from our community to help neighbours in Nova Scotia who can't keep up with their homes.",
};

const STEPS = [
  {
    icon: HeartIcon,
    title: "Customers can chip in",
    body: "At checkout you can round up or add $2, $5 or another amount. It's optional and nothing is pre-selected.",
  },
  {
    icon: UsersIcon,
    title: "Local partners refer neighbours",
    body: "Seniors' centres and community agencies we work with refer people who need a hand, with their permission.",
  },
  {
    icon: HomeIcon,
    title: "Local pros do the work",
    body: "We book Nevile pros at their normal price and pay them from the fund, so local businesses earn too.",
  },
] as const;

export default async function NeighboursPage() {
  const caller = await getServerCaller();
  const { enabled } = await caller.community.status();
  // The same example booking as the homepage: a $60 lawn mow in Nova Scotia.
  const example = calculateCharge({
    priceCents: 6000,
    province: "NS",
    businessTaxRegistered: true,
  });

  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <section
        aria-labelledby="neighbours-title"
        className="rounded-panel bg-season-tint px-4.5 py-8 sm:rounded-hero sm:px-11 sm:py-12"
      >
        <div className="nv-rise max-w-[44em]">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold tracking-[0.06em] text-season-ink uppercase">
              Nevile Neighbours
            </p>
            <LaunchStatus enabled={enabled} />
          </div>
          <h1
            id="neighbours-title"
            className="mt-3 font-display text-[34px] leading-[1.06] font-extrabold tracking-[-0.03em] text-balance sm:text-[46px]"
          >
            A hand for neighbours who can&apos;t keep up with their homes
          </h1>
          <p className="mt-4 text-[18px] leading-[1.55] text-ink">
            We&apos;re setting aside donations from our community to help neighbours who can&apos;t
            keep up with their homes.
          </p>
          <p className="mt-3 text-[16px] leading-[1.6] text-muted">
            Think of an older neighbour who can&apos;t shovel the walk anymore, or someone
            recovering at home with a lawn that keeps growing. Nevile Neighbours connects them with
            local pros, paid for by people who chose to chip in.
          </p>
          {!enabled ? (
            <p className="mt-4 rounded-input border border-border bg-surface px-4 py-3 text-[15px] leading-snug">
              <strong>We&apos;re getting ready.</strong>{" "}
              <span className="text-muted">
                Donations and referrals open when the program launches. Nothing is collected until
                then.
              </span>
            </p>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="how-title" className="pt-12">
        <h2
          id="how-title"
          className="font-display text-[26px] leading-tight font-bold tracking-[-0.02em] sm:text-[30px]"
        >
          How it works
        </h2>
        <ol className="mt-5 grid gap-4 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <Card className="h-full">
                <span
                  aria-hidden="true"
                  className="inline-flex size-11 items-center justify-center rounded-xl bg-season-tint text-season-ink"
                >
                  <step.icon size={22} />
                </span>
                <h3 className="mt-3 font-display text-[19px] leading-tight font-semibold">
                  <span className="sr-only">Step {index + 1}: </span>
                  {step.title}
                </h3>
                <p className="mt-1.5 text-[15px] leading-[1.55] text-muted">{step.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-labelledby="checkout-title"
        className="grid items-start gap-8 pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      >
        <div>
          <h2
            id="checkout-title"
            className="font-display text-[26px] leading-tight font-bold tracking-[-0.02em] sm:text-[30px]"
          >
            What you&apos;ll see at checkout
          </h2>
          <p className="mt-2 text-[16px] leading-[1.6] text-muted">
            Here&apos;s the donation step on an example {formatCad(example.totalCents)} booking. Try
            it: pick an option to see how much reaches the fund, or press it again to remove it.
          </p>
          <ul className="mt-4 grid gap-2.5 text-[15px] leading-snug">
            <li className="flex items-start gap-2.5">
              <ShieldIcon size={18} className="mt-0.5 flex-none text-primary" />
              <span>
                <strong>Donations aren&apos;t Nevile revenue.</strong>{" "}
                <span className="text-muted">
                  The only deduction is the 2.9% card fee, shown before you pay.
                </span>
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <ShieldIcon size={18} className="mt-0.5 flex-none text-primary" />
              <span>
                <strong>Refunded with your booking.</strong>{" "}
                <span className="text-muted">
                  If your booking is refunded in full, your donation is refunded too.
                </span>
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <ShieldIcon size={18} className="mt-0.5 flex-none text-primary" />
              <span>
                <strong>Tax receipts.</strong>{" "}
                <span className="text-muted">
                  We&apos;ll confirm before launch whether donations can get a charitable tax
                  receipt.
                </span>
              </span>
            </li>
          </ul>
        </div>
        <DonationPreview orderTotalCents={example.totalCents} />
      </section>

      <section aria-labelledby="trust-title" className="grid gap-4 pt-12 md:grid-cols-2">
        <Card>
          <h2 id="trust-title" className="font-display text-[22px] leading-tight font-bold">
            Open books
          </h2>
          <p className="mt-2 text-[15px] leading-[1.6] text-muted">
            Every donation, card fee and payment to a pro is recorded in a ledger that can&apos;t be
            edited after the fact. Our impact page shows the totals and the jobs done in each
            region, never names or addresses.
          </p>
          <Link
            href="/neighbours/impact"
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary"
          >
            See the impact page <ArrowRightIcon size={18} />
          </Link>
        </Card>
        <Card>
          <h2 className="font-display text-[22px] leading-tight font-bold">
            For partner organizations
          </h2>
          <p className="mt-2 text-[15px] leading-[1.6] text-muted">
            We work with registered community organizations across Nova Scotia. Partners refer
            neighbours with their consent and only share what&apos;s needed to do the job, never
            health, age or income details.
          </p>
          {enabled ? (
            <Link
              href="/partners/refer"
              className="mt-3 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary"
            >
              Partner staff: make a referral <ArrowRightIcon size={18} />
            </Link>
          ) : (
            <p className="mt-3 text-[15px] font-medium">Partner sign-up opens at launch.</p>
          )}
        </Card>
      </section>
    </Container>
  );
}
