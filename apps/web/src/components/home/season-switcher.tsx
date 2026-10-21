"use client";

import { SEASONS } from "@nevile/tokens";
import { Icon, SEASON_ICONS } from "@/components/ui/icons.tsx";
import { cn } from "@/lib/cn.ts";
import { SEASON_COPY } from "./season-content.ts";
import { useSeason } from "./season-scope.tsx";

/**
 * Segmented season picker built on native radio inputs, so it gets a single tab stop and
 * arrow-key selection from the browser.
 */
export function SeasonSwitcher({ className }: { className?: string }) {
  const { season, setSeason } = useSeason();
  return (
    <fieldset
      className={cn(
        "m-0 flex min-w-0 gap-0.5 rounded-full border border-border bg-surface p-1 shadow-card",
        className,
      )}
    >
      <legend className="sr-only">Choose a season</legend>
      {SEASONS.map((id) => {
        const checked = id === season;
        return (
          <label
            key={id}
            className={cn(
              "relative inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold whitespace-nowrap transition-colors duration-200 sm:h-[38px] sm:px-3.5",
              "has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
              checked ? "text-white" : "text-ink hover:bg-[#EEF1EA]",
            )}
            style={checked ? { backgroundColor: `var(--nv-${id}-ink)` } : undefined}
          >
            <input
              type="radio"
              name="season"
              value={id}
              checked={checked}
              onChange={() => setSeason(id)}
              className="sr-only"
            />
            <Icon name={SEASON_ICONS[id]} size={16} className="hidden sm:block" />
            <span>{SEASON_COPY[id].label}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
