import type { SearchLocation } from "@nevile/api";
import { DEFAULT_CATEGORIES, SEARCH_PAGE_SIZE } from "@nevile/core";
import { TRPCError } from "@trpc/server";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button.tsx";
import { Container } from "@/components/ui/container.tsx";
import { ArrowRightIcon, categoryIconName, Icon, InfoIcon } from "@/components/ui/icons.tsx";
import { getSessionOrNull, hasSessionCookie } from "@/lib/auth.ts";
import { parseSearchParams, type SearchParams, searchHref } from "@/lib/search-options.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";
import { SearchBar } from "./search-bar.tsx";
import { SearchFilters } from "./search-filters.tsx";
import { SearchResults } from "./search-results.tsx";

export const metadata: Metadata = {
  title: "Find a pro",
  description: "Local home-service pros across Nova Scotia who serve your street.",
  robots: { index: false },
};

type SearchPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** One line saying where the results are for, including any fallback (SPEC §18). */
function locationNote(location: SearchLocation): { text: string; tone: "plain" | "info" } {
  switch (location.kind) {
    case "postal":
      return location.requested === location.code
        ? { text: `Near ${location.code} · ${location.placeName}`, tone: "plain" }
        : {
            text: `We don't have ${location.requested} on file yet, so we're using nearby ${location.code} · ${location.placeName}.`,
            tone: "info",
          };
    case "near":
      return { text: "Near your location", tone: "plain" };
    case "outside":
      return { text: `${location.message} Postal codes here start with B.`, tone: "info" };
    case "province":
      if (location.reason === "unknown_area") {
        return {
          text: `We don't know ${location.requested} yet, so here are pros across Nova Scotia. Distances aren't shown.`,
          tone: "info",
        };
      }
      if (location.reason === "outside_bounds") {
        return {
          text: "Your location looks outside Nova Scotia, so here are pros across the province.",
          tone: "info",
        };
      }
      return {
        text: "Across Nova Scotia. Add your postal code to see who serves your street.",
        tone: "plain",
      };
  }
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const raw = await searchParams;
  let params = parseSearchParams(raw);
  // Pros already picked for a quote request (coming back from the request form).
  const picked =
    typeof raw.quote === "string" ? raw.quote.split(",").filter(Boolean).slice(0, 3) : [];
  const caller = await getServerCaller();

  // Signed-in customers who saved a postal code start from it (SPEC §16).
  let fromAccount = false;
  if (!params.postal && !params.near && (await hasSessionCookie()) && (await getSessionOrNull())) {
    const saved = (await caller.me.get().catch(() => null))?.onboarding.postalCode;
    if (saved) {
      params = { ...params, postal: saved };
      fromAccount = true;
    }
  }

  let data: Awaited<ReturnType<typeof caller.search.query>> | null = null;
  let inputProblem: string | null = null;
  try {
    data = await caller.search.query({
      category: params.service,
      postalCode: params.postal,
      near: params.near,
      sort: params.sort,
      instantBook: params.filters.instant,
      verified: params.filters.verified,
      pro: params.filters.pro,
      topRated: params.filters.top,
      page: params.page,
    });
  } catch (error) {
    if (!(error instanceof TRPCError) || error.code !== "BAD_REQUEST") throw error;
    inputProblem = error.message;
  }

  const category = DEFAULT_CATEGORIES.find((item) => item.slug === params.service);
  const note = data ? locationNote(data.location) : null;
  const heading = category ? category.name : "Home services";

  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <h1 className="sr-only">Find a pro</h1>
      <SearchBar
        key={`${params.service ?? ""}|${params.postal ?? ""}`}
        params={params}
        categories={DEFAULT_CATEGORIES}
      />

      <section aria-labelledby="results-title" className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              id="results-title"
              className="font-display text-[26px] leading-tight font-bold tracking-[-0.02em] sm:text-[30px]"
            >
              {heading}
              {data && data.location.kind !== "outside" ? (
                <span className="ml-2 align-middle text-base font-semibold text-muted">
                  {data.total} {data.total === 1 ? "pro" : "pros"}
                </span>
              ) : null}
            </h2>
            {note ? (
              <p
                className={
                  note.tone === "info"
                    ? "mt-1.5 flex max-w-[44em] items-start gap-1.5 text-[15px] text-ink"
                    : "mt-1.5 text-[15px] text-muted"
                }
              >
                {note.tone === "info" ? (
                  <InfoIcon size={18} className="mt-0.5 flex-none text-primary" />
                ) : null}
                <span>
                  {note.text}
                  {fromAccount ? " (from your account)" : ""}
                </span>
              </p>
            ) : null}
          </div>
          <SearchFilters params={params} />
        </div>

        <div className="mt-5">
          {inputProblem ? (
            <EmptyState title="Check that postal code" body={inputProblem} />
          ) : !data || data.location.kind === "outside" ? (
            <EmptyState
              title="Nevile is only in Nova Scotia for now"
              body="We'll let you know when we reach more places. If you're looking for someone in Nova Scotia, enter a postal code that starts with B."
            />
          ) : data.results.length === 0 ? (
            <NoResults params={params} />
          ) : (
            <>
              <SearchResults
                results={data.results}
                quote={
                  params.service
                    ? { categorySlug: params.service, postalCode: params.postal ?? "", picked }
                    : null
                }
              />
              <Pagination params={params} hasMore={data.hasMore} total={data.total} />
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="all-services" className="pt-14">
        <h2
          id="all-services"
          className="font-display text-[22px] leading-[1.15] font-bold tracking-[-0.02em]"
        >
          Browse by service
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {DEFAULT_CATEGORIES.map((item) => (
            <li key={item.slug}>
              <Link
                href={searchHref(params, { service: item.slug })}
                aria-current={item.slug === params.service ? "true" : undefined}
                className="group flex h-full min-h-[64px] items-center gap-3 rounded-card border border-border bg-surface px-3.5 py-3 text-ink no-underline shadow-card transition-colors hover:border-field hover:text-ink aria-[current=true]:border-primary aria-[current=true]:ring-1 aria-[current=true]:ring-primary"
              >
                <span className="inline-flex size-10 flex-none items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <Icon name={categoryIconName(item.slug)} size={20} strokeWidth={1.85} />
                </span>
                <span className="min-w-0 flex-1 text-[15px] leading-snug font-semibold">
                  {item.name}
                </span>
                <ArrowRightIcon size={16} className="flex-none text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Container>
  );
}

function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-panel border border-dashed border-field bg-surface px-5 py-10 text-center sm:px-10">
      <h3 className="font-display text-[22px] font-bold tracking-[-0.02em]">{title}</h3>
      <p className="mx-auto mt-2 max-w-[34em] text-[15px] leading-relaxed text-muted">{body}</p>
      {children ? <div className="mt-5 flex flex-wrap justify-center gap-3">{children}</div> : null}
    </div>
  );
}

function NoResults({ params }: { params: SearchParams }) {
  const filtered = Object.values(params.filters).some(Boolean);
  return (
    <EmptyState
      title="No pros here yet"
      body={
        filtered
          ? "Nobody matches all of those filters. Try turning some off."
          : "Nevile is new, and pros are joining across Nova Scotia every week. Try another service, or check back soon."
      }
    >
      {filtered ? (
        <Button
          href={searchHref(params, {
            filters: { instant: false, verified: false, pro: false, top: false },
          })}
        >
          Clear filters
        </Button>
      ) : params.service ? (
        <Button href={searchHref(params, { service: undefined })}>Show every service</Button>
      ) : null}
      <Button href={"/for-businesses" as Route} variant="secondary">
        Run a business? List it free
      </Button>
    </EmptyState>
  );
}

function Pagination({
  params,
  hasMore,
  total,
}: {
  params: SearchParams;
  hasMore: boolean;
  total: number;
}) {
  if (params.page === 1 && !hasMore) return null;
  const first = (params.page - 1) * SEARCH_PAGE_SIZE + 1;
  const last = Math.min(params.page * SEARCH_PAGE_SIZE, total);
  return (
    <nav aria-label="Result pages" className="mt-6 flex items-center justify-between gap-3">
      <span className="text-sm text-muted">
        {first}–{last} of {total}
      </span>
      <span className="flex gap-2">
        {params.page > 1 ? (
          <Button
            variant="secondary"
            size="sm"
            href={searchHref(params, { page: params.page - 1 })}
          >
            Previous
          </Button>
        ) : null}
        {hasMore ? (
          <Button
            variant="secondary"
            size="sm"
            href={searchHref(params, { page: params.page + 1 })}
          >
            Next
          </Button>
        ) : null}
      </span>
    </nav>
  );
}
