"use client";

import Form from "next/form";
import { Button } from "@/components/ui/button.tsx";
import { Input, Label, Select } from "@/components/ui/field.tsx";
import { SearchIcon } from "@/components/ui/icons.tsx";
import { ADDRESS_MAX_LENGTH, WHEN_OPTIONS } from "@/lib/search-options.ts";
import { useSeason } from "./season-scope.tsx";

type SearchCardProps = { categories: ReadonlyArray<{ slug: string; name: string }> };

/** The hero search, a plain GET form to /search so it works before hydration too. */
export function SearchCard({ categories }: SearchCardProps) {
  const { service, setService } = useSeason();
  return (
    <search aria-label="Find a home service" className="mt-7 block">
      <Form
        action="/search"
        className="grid grid-cols-[minmax(0,1fr)] items-end gap-3 rounded-card border border-border bg-surface p-4 shadow-card sm:grid-cols-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.35fr)_minmax(0,1fr)_auto]"
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
          <Label htmlFor="q-address">Your address</Label>
          <Input
            id="q-address"
            name="address"
            icon="pin"
            placeholder="123 Main St, Ottawa"
            autoComplete="street-address"
            maxLength={ADDRESS_MAX_LENGTH}
            required
          />
        </div>
        <div>
          <Label htmlFor="q-when">When?</Label>
          <Select id="q-when" name="when" icon="calendar" defaultValue="any">
            {WHEN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" size="lg" shape="rounded" className="h-12 px-6.5">
          <SearchIcon size={18} />
          <span>Search</span>
        </Button>
      </Form>
    </search>
  );
}
