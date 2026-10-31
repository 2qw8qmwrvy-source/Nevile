import type { Route } from "next";
import Link from "next/link";
import { cn } from "@/lib/cn.ts";

const TABS = [
  { href: "/business", label: "Listing" },
  { href: "/business/calendar", label: "Calendar" },
  { href: "/business/snow-route", label: "Snow route" },
  { href: "/business/quotes", label: "Quotes", editorsOnly: true },
  { href: "/business/team", label: "Team" },
  { href: "/business/payouts", label: "Payouts", editorsOnly: true },
] as const;

type BusinessNavProps = {
  current: (typeof TABS)[number]["href"];
  businessId: string;
  /** Other businesses the person belongs to (switcher). */
  businesses: ReadonlyArray<{ id: string; name: string }>;
  role: "owner" | "manager" | "crew";
};

/** Business-mode tabs, plus a switcher for people in more than one business. */
export function BusinessNav({ current, businessId, businesses, role }: BusinessNavProps) {
  const suffix = businesses.length > 1 ? `?b=${businessId}` : "";
  return (
    <div className="mb-6 grid gap-3">
      {businesses.length > 1 ? (
        <nav aria-label="Your businesses" className="flex flex-wrap gap-2">
          {businesses.map((business) => (
            <Link
              key={business.id}
              href={`${current}?b=${business.id}` as Route}
              aria-current={business.id === businessId ? "page" : undefined}
              className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-[15px] font-semibold text-ink no-underline aria-[current=page]:border-primary aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary"
            >
              {business.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <nav
        aria-label="Business mode"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1"
      >
        {TABS.filter((tab) => !("editorsOnly" in tab) || role !== "crew").map((tab) => (
          <Link
            key={tab.href}
            href={`${tab.href}${suffix}` as Route}
            aria-current={tab.href === current ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-11 items-center border-b-2 px-3.5 text-[15px] font-semibold whitespace-nowrap no-underline",
              tab.href === current
                ? "border-primary text-primary"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
