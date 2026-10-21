"use client";

import { Icon, SEASON_ICONS } from "@/components/ui/icons.tsx";
import { HeroArt } from "./hero-art.tsx";
import { SEASON_ART, SEASON_COPY } from "./season-content.ts";
import { useSeason } from "./season-scope.tsx";
import { SeasonSwitcher } from "./season-switcher.tsx";

export function SeasonalHero() {
  const { season } = useSeason();
  const copy = SEASON_COPY[season];
  return (
    <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:gap-10">
      <div>
        <p className="inline-flex items-center gap-2 text-sm font-semibold tracking-[0.06em] text-season-ink uppercase">
          <Icon name={SEASON_ICONS[season]} size={18} />
          <span>{copy.eyebrow}</span>
        </p>
        <h1
          id="hero-title"
          className="mt-3.5 font-display text-[36px] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance text-ink sm:text-[46px]"
        >
          {copy.headline}
        </h1>
        <p className="mt-4 max-w-[34em] text-[17px] leading-[1.55] text-muted">{copy.sub}</p>
        <p className="mt-5 inline-flex items-center gap-2.5 rounded-full border border-border bg-surface py-1.5 pr-3.5 pl-1.5 text-sm leading-snug font-medium text-ink">
          <span className="inline-flex size-7 flex-none items-center justify-center rounded-full bg-season-tint text-season-ink">
            <Icon name={copy.noteIcon} size={16} />
          </span>
          <span>{copy.note}</span>
        </p>
      </div>
      <div
        className="relative h-[240px] overflow-hidden rounded-panel sm:h-[330px]"
        style={{ backgroundColor: SEASON_ART[season].sky }}
      >
        <HeroArt art={SEASON_ART[season]} />
        <SeasonSwitcher className="absolute top-2.5 left-2.5 sm:top-3.5 sm:left-3.5" />
      </div>
      <p className="sr-only" aria-live="polite">
        Showing {copy.label.toLowerCase()} services
      </p>
    </div>
  );
}
