import { formatCad } from "@nevile/core";
import type { Metadata } from "next";
import Link from "next/link";
import { LaunchStatus } from "@/components/neighbours/launch-status.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Container } from "@/components/ui/container.tsx";
import { ArrowRightIcon } from "@/components/ui/icons.tsx";
import { getServerCaller } from "@/lib/trpc-server.ts";

export const metadata: Metadata = {
  title: "Nevile Neighbours impact",
  description:
    "Live totals for Nevile Neighbours: donations, card fees, payments to local pros and jobs completed across Nova Scotia.",
};

export default async function ImpactPage() {
  const caller = await getServerCaller();
  const impact = await caller.community.impact();
  const stats = [
    { label: "Donated", value: formatCad(impact.donatedCents) },
    { label: "Card fees", value: formatCad(impact.feesCents) },
    { label: "Paid to local pros", value: formatCad(impact.paidToProsCents) },
    { label: "Jobs completed", value: impact.completedJobs.toLocaleString("en-CA") },
  ];
  const empty = impact.donatedCents === 0 && impact.completedJobs === 0;

  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <section
        aria-labelledby="impact-title"
        className="rounded-panel bg-season-tint px-4.5 py-8 sm:rounded-hero sm:px-11 sm:py-11"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/neighbours"
            className="text-sm font-semibold tracking-[0.06em] text-season-ink uppercase no-underline hover:underline"
          >
            Nevile Neighbours
          </Link>
          <LaunchStatus enabled={impact.enabled} />
        </div>
        <h1
          id="impact-title"
          className="mt-3 font-display text-[32px] leading-[1.08] font-extrabold tracking-[-0.03em] sm:text-[42px]"
        >
          Our impact, in the open
        </h1>
        <p className="mt-3 max-w-[40em] text-[16px] leading-[1.6] text-muted">
          These numbers come straight from the program&apos;s ledger, which can&apos;t be edited
          after the fact. We never show names or addresses.
        </p>
      </section>

      <section aria-label="Totals" className="mt-6">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Card key={stat.label} className="nv-rise">
              <dt className="text-sm font-semibold text-muted">{stat.label}</dt>
              <dd className="mt-1 font-display text-[30px] leading-none font-bold tabular-nums">
                {stat.value}
              </dd>
            </Card>
          ))}
        </dl>
        {empty ? (
          <p className="mt-4 text-[15px] text-muted">
            {impact.enabled
              ? "No donations yet. The first ones will show up here."
              : "Nothing yet: the program is launching soon, and nothing is collected until then."}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="regions-title" className="mt-10">
        <h2
          id="regions-title"
          className="font-display text-[24px] leading-tight font-bold tracking-[-0.02em]"
        >
          Jobs by region
        </h2>
        <p className="mt-1.5 text-[15px] text-muted">
          A region appears once it has at least {impact.regionThreshold} completed jobs, so no one
          can be identified.
        </p>
        {impact.regions.length > 0 ? (
          <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {impact.regions.map((region) => (
              <li
                key={region.regionId}
                className="flex items-center justify-between gap-3 rounded-input border border-border bg-surface px-4 py-3"
              >
                <span className="font-semibold">{region.name}</span>
                <span className="tabular-nums text-muted">
                  {region.completedJobs.toLocaleString("en-CA")} jobs
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-input border border-dashed border-field bg-surface px-4 py-6 text-center text-[15px] text-muted">
            No regions to show yet.
          </p>
        )}
      </section>

      <Link
        href="/neighbours"
        className="mt-10 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary"
      >
        How Nevile Neighbours works <ArrowRightIcon size={18} />
      </Link>
    </Container>
  );
}
