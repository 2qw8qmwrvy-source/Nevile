"use client";

import { postalAreaOf } from "@nevile/core";
import Form from "next/form";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input, Label, Select } from "@/components/ui/field.tsx";
import { SearchIcon } from "@/components/ui/icons.tsx";

type SearchCardProps = {
  categories: ReadonlyArray<{ slug: string; name: string }>;
  /** Pre-selected service: the current season's most-booked category. */
  defaultService: string;
};

/**
 * The hero search, a plain GET form to /search so it works before hydration too.
 * Signed-in customers who leave the postal code empty get their saved one on /search.
 */
export function SearchCard({ categories, defaultService }: SearchCardProps) {
  const [service, setService] = useState(defaultService);
  const [problem, setProblem] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const postal = new FormData(event.currentTarget).get("postal");
    if (typeof postal === "string" && postal.trim() && !postalAreaOf(postal)) {
      event.preventDefault();
      setProblem("Enter a postal code like B3H 1A1.");
    }
  }

  return (
    <search aria-label="Find a home service" className="mt-7 block">
      <Form
        action="/search"
        onSubmit={onSubmit}
        noValidate
        className="grid grid-cols-[minmax(0,1fr)] items-end gap-3 rounded-card border border-border bg-surface p-4 shadow-card sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]"
      >
        <div>
          <Label htmlFor="q-service">What do you need?</Label>
          <Select
            id="q-service"
            name="service"
            value={service}
            onChange={(event) => setService(event.target.value)}
          >
            {categories.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="q-postal">Your postal code</Label>
          <Input
            id="q-postal"
            name="postal"
            icon="pin"
            placeholder="B3H 1A1"
            autoComplete="postal-code"
            autoCapitalize="characters"
            maxLength={7}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? "q-postal-problem" : undefined}
            onChange={() => setProblem(null)}
            className="uppercase"
          />
        </div>
        <Button type="submit" size="lg" shape="rounded" className="h-12 px-6.5">
          <SearchIcon size={18} />
          <span>Search</span>
        </Button>
      </Form>
      {problem ? (
        <p id="q-postal-problem" role="alert" className="mt-2 ml-1 text-sm font-medium text-danger">
          {problem}
        </p>
      ) : null}
    </search>
  );
}
