import { CATEGORY_SLUGS, DEFAULT_CATEGORIES } from "@nevile/core";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { z } from "zod";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Container } from "@/components/ui/container.tsx";
import { ArrowRightIcon, categoryIconName, Icon, SearchIcon } from "@/components/ui/icons.tsx";
import {
  ADDRESS_MAX_LENGTH,
  WHEN_VALUES,
  type WhenValue,
  whenLabel,
} from "@/lib/search-options.ts";

export const metadata: Metadata = {
  title: "Search",
  description: "Find local home-service businesses that serve your address.",
  robots: { index: false },
};

/** First value of a possibly repeated query parameter. */
const single = z.preprocess(
  (value) => (Array.isArray(value) ? value[0] : value),
  z.string().optional(),
);

const searchParamsSchema = z.object({
  service: single.pipe(z.enum(CATEGORY_SLUGS).optional()).catch(undefined),
  address: single
    .transform((value) => value?.trim().replace(/\s+/g, " ") || undefined)
    .pipe(z.string().max(ADDRESS_MAX_LENGTH).optional())
    .catch(undefined),
  when: single.pipe(z.enum(WHEN_VALUES).optional()).catch(undefined),
});

type SearchPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = searchParamsSchema.parse(await searchParams);
  const category = DEFAULT_CATEGORIES.find((item) => item.slug === params.service);
  const when: WhenValue = params.when ?? "any";

  return (
    <Container className="pt-1">
      <section
        aria-labelledby="search-title"
        className="rounded-panel bg-primary-soft px-4.5 py-8 sm:rounded-hero sm:px-11 sm:py-11"
      >
        <p className="inline-flex items-center gap-2 text-sm font-semibold tracking-[0.06em] text-primary uppercase">
          <SearchIcon size={18} />
          <span>Search</span>
        </p>
        <h1
          id="search-title"
          className="mt-3 max-w-[22ch] font-display text-[34px] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance sm:text-[44px]"
        >
          Search is coming next
        </h1>
        <p className="mt-4 max-w-[38em] text-[17px] leading-[1.55] text-muted">
          Soon you&apos;ll see a list and map of local businesses whose service area covers your
          address, with prices, reviews and next openings.
        </p>

        {category || params.address ? (
          <Card className="mt-6 max-w-xl" padding="sm">
            <h2 className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">
              You searched for
            </h2>
            <dl className="mt-2 grid gap-1 text-[15px]">
              <div className="flex gap-2">
                <dt className="w-20 flex-none text-muted">Service</dt>
                <dd className="font-semibold">{category?.name ?? "Any service"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 flex-none text-muted">Address</dt>
                <dd className="min-w-0 font-semibold break-words">
                  {params.address ?? "Not given"}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 flex-none text-muted">When</dt>
                <dd className="font-semibold">{whenLabel(when)}</dd>
              </div>
            </dl>
          </Card>
        ) : null}

        <div className="mt-7">
          <Button href="/">Back to home</Button>
        </div>
      </section>

      <section aria-labelledby="all-services" className="pt-12">
        <h2
          id="all-services"
          className="font-display text-[26px] leading-[1.15] font-bold tracking-[-0.02em] sm:text-[30px]"
        >
          All services
        </h2>
        <p className="mt-1.5 text-base text-muted">Every category on Nevile, all year round.</p>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {DEFAULT_CATEGORIES.map((item) => {
            const selected = item.slug === category?.slug;
            return (
              <li key={item.slug}>
                <Link
                  href={`/search?service=${item.slug}` as Route}
                  aria-current={selected ? "true" : undefined}
                  className="group flex h-full min-h-[76px] items-center gap-3.5 rounded-card border border-border bg-surface px-3.5 py-3 text-ink no-underline shadow-card transition-colors hover:border-field hover:text-ink aria-[current=true]:border-primary aria-[current=true]:ring-1 aria-[current=true]:ring-primary"
                >
                  <span className="inline-flex size-12 flex-none items-center justify-center rounded-[14px] bg-primary-soft text-primary">
                    <Icon name={categoryIconName(item.slug)} size={24} strokeWidth={1.85} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base leading-snug font-semibold">{item.name}</span>
                    <span className="mt-0.5 line-clamp-2 block text-sm leading-[1.35] text-muted">
                      {item.description}
                    </span>
                  </span>
                  <ArrowRightIcon size={18} className="flex-none text-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </Container>
  );
}
