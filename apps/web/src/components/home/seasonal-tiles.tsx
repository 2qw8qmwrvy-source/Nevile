"use client";

import type { Season } from "@nevile/tokens";
import type { Route } from "next";
import Link from "next/link";
import { ArrowRightIcon, categoryIconName, Icon } from "@/components/ui/icons.tsx";
import { cn } from "@/lib/cn.ts";
import { SEASON_COPY } from "./season-content.ts";
import { useSeason } from "./season-scope.tsx";

export type Tile = { slug: string; name: string; description: string };

type SeasonalTilesProps = {
  tiles: Readonly<Record<Season, readonly Tile[]>>;
  totalServices: number;
};

const columns: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
};

export function SeasonalTiles({ tiles, totalServices }: SeasonalTilesProps) {
  const { season } = useSeason();
  const list = tiles[season];
  return (
    <div id="services" className="mt-7">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 className="font-display text-xl leading-snug font-bold tracking-[-0.01em]">
          {SEASON_COPY[season].tilesTitle}
        </h2>
        <Link
          href="/search"
          className="inline-flex min-h-11 items-center text-[15px] font-semibold text-primary hover:text-primary-hover"
        >
          All {totalServices} services
        </Link>
      </div>
      <ul className={cn("grid gap-3 sm:grid-cols-2", columns[Math.min(list.length, 4)])}>
        {list.map((tile) => (
          <li key={tile.slug}>
            <Link
              href={`/search?service=${encodeURIComponent(tile.slug)}` as Route}
              className="group flex h-full min-h-[76px] items-center gap-3.5 rounded-card border border-border bg-surface px-3.5 py-3 text-ink no-underline shadow-card transition-colors hover:border-field hover:text-ink"
            >
              <span className="inline-flex size-12 flex-none items-center justify-center rounded-[14px] bg-season-tint text-season-ink">
                <Icon name={categoryIconName(tile.slug)} size={24} strokeWidth={1.85} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base leading-snug font-semibold">{tile.name}</span>
                <span className="mt-0.5 line-clamp-2 block text-sm leading-[1.35] text-muted">
                  {tile.description}
                </span>
              </span>
              <ArrowRightIcon
                size={18}
                className="flex-none text-muted transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
