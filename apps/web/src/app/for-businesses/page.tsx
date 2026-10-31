import { calculateBusinessFee, formatCad } from "@nevile/core";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Container } from "@/components/ui/container.tsx";
import { ArrowRightIcon, CheckIcon, Icon, type IconName } from "@/components/ui/icons.tsx";
import { BUSINESS_FEE_LABEL, formatPlanPrice, PRO_PLAN_MONTHLY_CENTS } from "@/lib/plans.ts";
import { authRoutes } from "@/lib/routes.ts";

export const metadata: Metadata = {
  title: "For businesses",
  description: `List your home-service business on Nevile for free. Bookings fill your calendar, teams are free, and you're paid every Monday with a flat ${BUSINESS_FEE_LABEL} fee.`,
  openGraph: { title: "Nevile for businesses", url: "/for-businesses" },
};

const EXAMPLE_JOB_CENTS = 10_000;

type Feature = { id: string; icon: IconName; title: string; body: ReactNode };

function features(): Feature[] {
  const fee = calculateBusinessFee(EXAMPLE_JOB_CENTS);
  return [
    {
      id: "calendar",
      icon: "calendar",
      title: "A calendar that fills itself",
      body: "Set working hours and days off for each crew member. Confirmed bookings and recurring visits land on the schedule automatically, and slots lock only once a booking is confirmed.",
    },
    {
      id: "teams",
      icon: "users",
      title: "Teams are free, on every plan",
      body: "Add your crew and give each member their own calendar. Customers book your business; you assign each job to the right person.",
    },
    {
      id: "payouts",
      icon: "clock",
      title: "Paid every Monday",
      body: "Customers pay in the app when they book. Funds are held until the job is confirmed complete, then paid out in a weekly batch every Monday through Stripe.",
    },
    {
      id: "fees",
      icon: "dollar",
      title: `A flat ${BUSINESS_FEE_LABEL} fee per job`,
      body: (
        <>
          No listing or lead fees. On a {formatCad(EXAMPLE_JOB_CENTS)} job you receive{" "}
          <strong className="text-ink">{formatCad(EXAMPLE_JOB_CENTS - fee)}</strong>. Tips are 100%
          yours.
        </>
      ),
    },
  ];
}

const FREE_PERKS = [
  "Unlimited service listings",
  "Team calendars for every crew member",
  "Quotes, fixed prices, Instant Book and recurring jobs",
  "Seasonal snow contracts with per-visit billing",
  "In-app chat with customers",
] as const;

const PRO_PERKS = [
  "Everything in Free",
  "Higher placement in search results",
  "Pro badge on your listing",
  "Analytics dashboard",
  "Automatic rebooking reminders to past customers",
] as const;

const CONTROLS: ReadonlyArray<{ icon: IconName; title: string; body: string }> = [
  {
    icon: "bolt",
    title: "Instant Book or approval",
    body: "Choose whether fixed-price bookings confirm instantly or wait for you. Requests you don't answer expire after 24 hours, with no charge to the customer.",
  },
  {
    icon: "shield",
    title: "Your cancellation policy",
    body: "Pick Flexible (free until 24h before), Moderate (free until 48h, then 50% refund) or Strict (free until 7 days before).",
  },
  {
    icon: "lock",
    title: "Verified and protected",
    body: "Verify your identity with Stripe to receive payouts, and upload proof of insurance to earn the Verified badge. Contact details stay private until a booking is paid.",
  },
  {
    icon: "repeat",
    title: "Built for every season",
    body: "Sell weekly, every-2-weeks or monthly visits, and snow contracts that clear whenever snowfall passes your threshold. Pause Pro in your off-season.",
  },
];

function PerkList({ items, inverse = false }: { items: readonly string[]; inverse?: boolean }) {
  return (
    <ul className="mt-5 grid gap-2.5">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5 text-[15px] leading-snug">
          <span
            aria-hidden="true"
            className={
              inverse
                ? "inline-flex size-6 flex-none items-center justify-center rounded-full bg-white/15 text-white"
                : "inline-flex size-6 flex-none items-center justify-center rounded-full bg-primary-soft text-primary"
            }
          >
            <CheckIcon size={14} strokeWidth={2.5} />
          </span>
          <span className={inverse ? "text-on-primary-muted" : "text-ink"}>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ForBusinessesPage() {
  const proPrice = formatPlanPrice(PRO_PLAN_MONTHLY_CENTS);
  return (
    <Container className="pt-1">
      <section
        aria-labelledby="fb-title"
        className="on-dark rounded-panel bg-primary px-5 py-9 text-white sm:rounded-hero sm:px-12 sm:py-14"
      >
        <p className="text-[13px] font-semibold tracking-[0.08em] text-on-primary-muted uppercase">
          Nevile for businesses
        </p>
        <h1
          id="fb-title"
          className="mt-3 max-w-[20ch] font-display text-[36px] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance text-white sm:text-[50px]"
        >
          Spend less time on the phone and more time on the job.
        </h1>
        <p className="mt-4 max-w-[38em] text-[17px] leading-[1.55] text-on-primary-muted">
          List your lawn, snow, cleaning or yard services for free. Customers near you book and pay
          in the app, the job lands on your crew&apos;s calendar, and you&apos;re paid every Monday.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button href={authRoutes.signUpBusiness} variant="inverse" size="lg">
            List your business
            <ArrowRightIcon size={18} />
          </Button>
          <Button
            href="/for-businesses#pro"
            variant="ghost"
            size="lg"
            className="text-white hover:bg-white/10 hover:text-white"
          >
            See plans
          </Button>
        </div>
        <p className="mt-3 text-sm text-on-primary-muted">
          Same login as your customer account: switch to business mode anytime.
        </p>
      </section>

      <section aria-labelledby="why-title" className="pt-14">
        <h2
          id="why-title"
          className="font-display text-[26px] leading-[1.15] font-bold tracking-[-0.02em] sm:text-[30px]"
        >
          Everything you need to run the week
        </h2>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {features().map((feature) => (
            <Card as="li" key={feature.id} id={feature.id} padding="md">
              <span className="inline-flex size-12 items-center justify-center rounded-[14px] bg-primary-soft text-primary">
                <Icon name={feature.icon} size={24} strokeWidth={1.85} />
              </span>
              <h3 className="mt-4 font-display text-[19px] leading-tight font-semibold">
                {feature.title}
              </h3>
              <p className="mt-2 text-[15px] leading-[1.55] text-muted">{feature.body}</p>
            </Card>
          ))}
        </ul>
      </section>

      <section id="pro" aria-labelledby="plans-title" className="pt-14">
        <h2
          id="plans-title"
          className="font-display text-[26px] leading-[1.15] font-bold tracking-[-0.02em] sm:text-[30px]"
        >
          Simple plans
        </h2>
        <p className="mt-1.5 max-w-[42em] text-base text-muted">
          The {BUSINESS_FEE_LABEL} fee is the same on every plan. Pro is billed monthly and you can
          pause it during your off-season.
        </p>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card padding="lg" className="flex flex-col">
            <h3 className="font-display text-2xl font-bold">Free</h3>
            <p className="mt-2 flex items-baseline gap-1.5">
              <span className="font-display text-[40px] leading-none font-extrabold">$0</span>
              <span className="text-muted">forever</span>
            </p>
            <p className="mt-3 text-[15px] text-muted">
              All the core booking tools for you and your crew.
            </p>
            <PerkList items={FREE_PERKS} />
            <div className="mt-auto pt-7">
              <Button href={authRoutes.signUpBusiness} variant="secondary" block size="lg">
                Start free
              </Button>
            </div>
          </Card>
          <div className="on-dark flex flex-col rounded-card bg-ink p-6 text-white shadow-card sm:p-8">
            <h3 className="font-display text-2xl font-bold">Pro</h3>
            <p className="mt-2 flex items-baseline gap-1.5">
              <span className="font-display text-[40px] leading-none font-extrabold">
                {proPrice}
              </span>
              <span className="text-on-primary-muted">per month, CAD</span>
            </p>
            <p className="mt-3 text-[15px] text-on-primary-muted">
              Get found first and keep past customers coming back.
            </p>
            <PerkList items={PRO_PERKS} inverse />
            <div className="mt-auto pt-7">
              <Button href={authRoutes.signUpBusiness} variant="inverse" block size="lg">
                Start with Pro
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section id="cancellations" aria-labelledby="control-title" className="pt-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2
              id="control-title"
              className="font-display text-[26px] leading-[1.15] font-bold tracking-[-0.02em] sm:text-[30px]"
            >
              Your business, your rules
            </h2>
            <p className="mt-1.5 text-base text-muted">Badges customers see on your listing:</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="verified" />
          <Badge variant="pro" />
          <Badge variant="instant" />
        </div>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {CONTROLS.map((item) => (
            <Card as="li" key={item.title} className="flex gap-4">
              <span className="inline-flex size-10 flex-none items-center justify-center rounded-full bg-primary-soft text-primary">
                <Icon name={item.icon} size={20} />
              </span>
              <div>
                <h3 className="mt-1.5 font-display text-[19px] leading-tight font-semibold">
                  {item.title}
                </h3>
                <p className="mt-1.5 text-[15px] leading-[1.55] text-muted">{item.body}</p>
              </div>
            </Card>
          ))}
        </ul>
      </section>

      <section aria-labelledby="cta-title" className="pt-14">
        <div className="flex flex-col items-start gap-5 rounded-card border border-border bg-primary-soft p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <h2 id="cta-title" className="font-display text-2xl leading-tight font-bold">
              Ready for your busiest season?
            </h2>
            <p className="mt-1 text-muted">
              Set up your listing in minutes. It&apos;s free to start.
            </p>
          </div>
          <Button href={authRoutes.signUpBusiness} size="lg">
            List your business
            <ArrowRightIcon size={18} />
          </Button>
        </div>
      </section>
    </Container>
  );
}
