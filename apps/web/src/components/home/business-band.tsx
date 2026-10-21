import Link from "next/link";
import { Button } from "@/components/ui/button.tsx";
import { ArrowRightIcon, CheckIcon } from "@/components/ui/icons.tsx";
import { BUSINESS_FEE_LABEL, formatPlanPrice, PRO_PLAN_MONTHLY_CENTS } from "@/lib/plans.ts";
import { authRoutes } from "@/lib/routes.ts";
import { CrewCalendarPreview } from "./crew-calendar-preview.tsx";

const POINTS = [
  ["A calendar that fills itself:", "bookings land on your schedule."],
  ["Teams included free:", "each crew member gets their own calendar."],
  ["Paid every Monday:", `weekly payouts, a flat ${BUSINESS_FEE_LABEL} fee per job.`],
] as const;

export function BusinessBand() {
  return (
    <section id="business" aria-labelledby="biz-title" className="pt-14">
      <div className="on-dark grid items-center gap-10 rounded-panel bg-primary px-5 py-7 text-white sm:rounded-hero sm:px-12 sm:py-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div>
          <p className="text-[13px] font-semibold tracking-[0.08em] text-on-primary-muted uppercase">
            For businesses
          </p>
          <h2
            id="biz-title"
            className="mt-2.5 font-display text-[26px] leading-[1.15] font-bold tracking-[-0.02em] text-white sm:text-[30px]"
          >
            <span className="block">Run a lawn, snow or cleaning business?</span>
            <span className="block">List your services free.</span>
          </h2>
          <ul className="mt-5.5 grid gap-3">
            {POINTS.map(([lead, rest]) => (
              <li key={lead} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="-mt-px inline-flex size-7 flex-none items-center justify-center rounded-full bg-white/15"
                >
                  <CheckIcon size={16} strokeWidth={2.25} />
                </span>
                <span className="text-base leading-normal text-on-primary-muted">
                  <strong className="text-white">{lead}</strong> {rest}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-6.5 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Button href={authRoutes.signUpBusiness} variant="inverse" size="lg">
              List your business
              <ArrowRightIcon size={18} />
            </Button>
            <Link
              href="/for-businesses#pro"
              className="inline-flex min-h-11 items-center text-[15px] font-semibold text-white underline underline-offset-2 hover:text-on-primary-muted"
            >
              Pro plan, {formatPlanPrice(PRO_PLAN_MONTHLY_CENTS)}/mo: top placement and analytics
            </Link>
          </div>
          <p className="mt-2.5 text-sm leading-normal text-on-primary-muted">
            Same login as your customer account: switch to business mode anytime.
          </p>
        </div>
        <CrewCalendarPreview />
      </div>
    </section>
  );
}
