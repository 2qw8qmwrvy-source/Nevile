"use client";

import { SEARCH_SORT_LABELS, SEARCH_SORTS, type SearchSort } from "@nevile/core";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/field.tsx";
import { CheckIcon } from "@/components/ui/icons.tsx";
import { cn } from "@/lib/cn.ts";
import { SEARCH_FILTERS, type SearchParams, searchHref } from "@/lib/search-options.ts";

/** Sort order and filter toggles; each change navigates to the matching /search URL. */
export function SearchFilters({ params }: { params: SearchParams }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const go = (changes: Partial<SearchParams>) =>
    startTransition(() => router.push(searchHref(params, changes), { scroll: false }));

  return (
    <div
      className={cn("flex flex-wrap items-center gap-2.5", pending && "opacity-70")}
      aria-busy={pending}
    >
      <div className="w-44">
        <label htmlFor="search-sort" className="sr-only">
          Sort by
        </label>
        <Select
          id="search-sort"
          value={params.sort}
          className="h-11"
          onChange={(event) => go({ sort: event.target.value as SearchSort })}
        >
          {SEARCH_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {SEARCH_SORT_LABELS[sort]}
            </option>
          ))}
        </Select>
      </div>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Filters</legend>
        {SEARCH_FILTERS.map((filter) => {
          const on = params.filters[filter.key];
          return (
            <button
              key={filter.key}
              type="button"
              aria-pressed={on}
              onClick={() => go({ filters: { ...params.filters, [filter.key]: !on } })}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-[15px] font-semibold transition-colors",
                on
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border bg-surface text-ink hover:border-field",
              )}
            >
              {on ? <CheckIcon size={16} /> : null}
              {filter.label}
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}
