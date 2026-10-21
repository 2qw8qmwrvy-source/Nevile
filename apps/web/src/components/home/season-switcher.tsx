"use client";

import { type Season, SEASONS } from "@nevile/tokens";
import { type KeyboardEvent, useRef } from "react";
import { Icon, SEASON_ICONS } from "@/components/ui/icons.tsx";
import { cn } from "@/lib/cn.ts";
import { SEASON_COPY } from "./season-content.ts";
import { useSeason } from "./season-scope.tsx";

/**
 * Segmented season picker using the ARIA radio-group pattern: one tab stop, arrow keys
 * move and select, Home/End jump to the ends.
 */
export function SeasonSwitcher({ className }: { className?: string }) {
  const { season, setSeason } = useSeason();
  const refs = useRef<Partial<Record<Season, HTMLButtonElement | null>>>({});

  function select(next: Season) {
    setSeason(next);
    refs.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = SEASONS.indexOf(season);
    const last = SEASONS.length - 1;
    let target: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") target = index === last ? 0 : index + 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") target = index === 0 ? last : index - 1;
    if (event.key === "Home") target = 0;
    if (event.key === "End") target = last;
    const next = target === null ? undefined : SEASONS[target];
    if (next) {
      event.preventDefault();
      select(next);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Choose a season"
      className={cn(
        "flex gap-0.5 rounded-full border border-border bg-surface p-1 shadow-card",
        className,
      )}
    >
      {SEASONS.map((id) => {
        const checked = id === season;
        return (
          <button
            key={id}
            ref={(node) => {
              refs.current[id] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => select(id)}
            onKeyDown={onKeyDown}
            className={cn(
              "inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold whitespace-nowrap transition-colors duration-200 sm:h-[38px] sm:px-3.5",
              checked ? "text-white" : "text-ink hover:bg-[#EEF1EA]",
            )}
            style={checked ? { backgroundColor: `var(--nv-${id}-ink)` } : undefined}
          >
            <Icon name={SEASON_ICONS[id]} size={16} className="hidden sm:block" />
            <span>{SEASON_COPY[id].label}</span>
          </button>
        );
      })}
    </div>
  );
}
