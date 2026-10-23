"use client";

import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import type { Route } from "next";
import Link from "next/link";
import { useMemo, useState } from "react";
import { MapView } from "@/components/map/map-view.tsx";
import { ProAvatar } from "@/components/pros/pro-avatar.tsx";
import { ProBadges } from "@/components/pros/pro-badges.tsx";
import { Rating } from "@/components/pros/rating.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ArrowRightIcon, PinIcon } from "@/components/ui/icons.tsx";
import { cn } from "@/lib/cn.ts";

type SearchOutput = inferRouterOutputs<AppRouter>["search"]["query"];
export type SearchResult = SearchOutput["results"][number];

/**
 * The result list and its map. The list is the primary, accessible view; the map shows
 * the same businesses at approximate locations. Hovering or focusing a card highlights
 * its pin, and choosing a pin highlights the card.
 */
export function SearchResults({ results }: { results: readonly SearchResult[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const pins = useMemo(
    () => results.map((result) => ({ id: result.id, ...result.pin, label: result.name })),
    [results],
  );

  function selectFromMap(id: string) {
    setSelectedId(id);
    document
      .getElementById(`result-${id}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:items-start">
      <div className="lg:hidden">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowMap((value) => !value)}
          aria-expanded={showMap}
          aria-controls="search-map"
        >
          <PinIcon size={18} />
          {showMap ? "Hide map" : "Show map"}
        </Button>
      </div>
      <ol className="grid gap-3" aria-label="Pros that serve your area">
        {results.map((result) => (
          <li key={result.id} id={`result-${result.id}`}>
            <Link
              href={`/pros/${result.slug}` as Route}
              onMouseEnter={() => setSelectedId(result.id)}
              onFocus={() => setSelectedId(result.id)}
              className={cn(
                "group grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-card border bg-surface p-4 text-ink no-underline shadow-card transition-colors hover:text-ink sm:p-5",
                selectedId === result.id ? "border-primary" : "border-border hover:border-field",
              )}
            >
              <ProAvatar name={result.name} logoUrl={result.logoUrl} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <h3 className="font-display text-[19px] leading-snug font-bold tracking-[-0.01em]">
                    {result.name}
                  </h3>
                  <ProBadges badges={result.badges} />
                </div>
                <Rating rating={result.rating} className="mt-1" />
                <p className="mt-2 text-[15px] leading-snug">
                  <span className="font-semibold">{result.service.title}</span>
                  <span className="text-muted"> · </span>
                  <span>{result.service.priceText}</span>
                  {result.serviceCount > 1 ? (
                    <span className="text-muted"> · {result.serviceCount - 1} more</span>
                  ) : null}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {result.distanceText ? `${result.distanceText} away · ` : ""}
                  {result.areaText} · {result.cancellationPolicy} cancellation
                </p>
              </div>
              <ArrowRightIcon
                size={18}
                className="col-start-2 justify-self-end text-muted transition-transform group-hover:translate-x-0.5 sm:hidden"
              />
            </Link>
          </li>
        ))}
      </ol>
      <div
        id="search-map"
        className={cn("lg:sticky lg:top-24 lg:block", showMap ? "block" : "hidden")}
      >
        <MapView
          label="Map of the pros in these results, at approximate locations"
          pins={pins}
          selectedId={selectedId}
          onSelectPin={selectFromMap}
          className="h-[360px] lg:h-[calc(100vh-8rem)] lg:max-h-[720px]"
        />
        <p className="mt-2 text-xs text-muted">
          Pins are approximate (about 1 km) to protect each pro&apos;s privacy.
        </p>
      </div>
    </div>
  );
}
