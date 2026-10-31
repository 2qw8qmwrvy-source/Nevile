"use client";

import { postalAreaOf } from "@nevile/core";
import Form from "next/form";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input, Label, Select } from "@/components/ui/field.tsx";
import { PinIcon, SearchIcon } from "@/components/ui/icons.tsx";
import { SEARCH_FILTERS, type SearchParams, searchHref } from "@/lib/search-options.ts";

type SearchBarProps = {
  params: SearchParams;
  categories: ReadonlyArray<{ slug: string; name: string }>;
};

/**
 * Service + postal code, as a plain GET form so it works before hydration too, plus
 * "Use my location" (rounded to about 1 km before it leaves the browser, never stored).
 */
export function SearchBar({ params, categories }: SearchBarProps) {
  const router = useRouter();
  const [service, setService] = useState<string>(params.service ?? "");
  const [postal, setPostal] = useState(params.postal ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (postal.trim() && !postalAreaOf(postal)) {
      event.preventDefault();
      setProblem("Enter a postal code like B3H 1A1.");
    }
  }

  function locate() {
    if (!("geolocation" in navigator)) {
      setProblem("Your browser can't share a location. Enter your postal code instead.");
      return;
    }
    setLocating(true);
    setProblem(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        router.push(
          searchHref(params, {
            service: (service || undefined) as SearchParams["service"],
            near: { lat: position.coords.latitude, lng: position.coords.longitude },
            postal: undefined,
          }),
        );
      },
      () => {
        setLocating(false);
        setProblem("We couldn't get your location. Enter your postal code instead.");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  }

  return (
    <search aria-label="Search for a pro" className="block">
      <Form
        action="/search"
        onSubmit={onSubmit}
        noValidate
        className="grid grid-cols-[minmax(0,1fr)] items-end gap-3 rounded-card border border-border bg-surface p-4 shadow-card sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto]"
      >
        <div>
          <Label htmlFor="search-service">What do you need?</Label>
          <Select
            id="search-service"
            name="service"
            value={service}
            onChange={(event) => setService(event.target.value)}
          >
            <option value="">Any service</option>
            {categories.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="search-postal">Postal code</Label>
          <Input
            id="search-postal"
            name="postal"
            icon="pin"
            placeholder="B3H 1A1"
            autoComplete="postal-code"
            autoCapitalize="characters"
            maxLength={7}
            value={postal}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? "search-problem" : undefined}
            onChange={(event) => {
              setPostal(event.target.value);
              setProblem(null);
            }}
            className="uppercase"
          />
        </div>
        {params.sort !== "best" ? <input type="hidden" name="sort" value={params.sort} /> : null}
        {SEARCH_FILTERS.filter((filter) => params.filters[filter.key]).map((filter) => (
          <input key={filter.key} type="hidden" name={filter.key} value="1" />
        ))}
        <Button
          variant="secondary"
          shape="rounded"
          className="h-12"
          onClick={locate}
          disabled={locating}
          aria-busy={locating}
        >
          <PinIcon size={18} />
          <span>{locating ? "Finding you…" : "Use my location"}</span>
        </Button>
        <Button type="submit" size="lg" shape="rounded" className="h-12 px-6.5">
          <SearchIcon size={18} />
          <span>Search</span>
        </Button>
      </Form>
      {problem ? (
        <p id="search-problem" role="alert" className="mt-2 ml-1 text-sm font-medium text-danger">
          {problem}
        </p>
      ) : null}
    </search>
  );
}
