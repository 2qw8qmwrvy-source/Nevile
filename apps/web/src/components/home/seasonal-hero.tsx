import type { SeasonNudge } from "@nevile/core";
import type { Season } from "@nevile/tokens";
import type { Route } from "next";
import Link from "next/link";
import { ArrowRightIcon, categoryIconName, Icon, SEASON_ICONS } from "@/components/ui/icons.tsx";
import { HeroArt } from "./hero-art.tsx";
import { SEASON_ART, SEASON_COPY } from "./season-content.ts";

type SeasonalHeroProps = {
  season: Season;
  /** Set in the last month of a season (SPEC §13): a gentle pointer to what's next. */
  nudge: SeasonNudge | null;
};

/** Hero for the current Nova Scotia season. There is no manual switch (SPEC §13). */
export function SeasonalHero({ season, nudge }: SeasonalHeroProps) {
  const copy = SEASON_COPY[season];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:gap-10">
      <div className="nv-rise">
        <p className="inline-flex items-center gap-2 text-sm font-semibold tracking-[0.06em] text-season-ink uppercase">
          <Icon name={SEASON_ICONS[season]} size={18} />
          <span>{copy.eyebrow}</span>
        </p>
        <h1
          id="hero-title"
          className="mt-3.5 font-display text-[34px] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance text-ink sm:text-[46px]"
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
        {nudge ? (
          <Link
            href={`/search?service=${encodeURIComponent(nudge.categorySlug)}` as Route}
            className="group mt-3 flex max-w-[34em] items-center gap-3 rounded-card border border-border bg-surface px-3.5 py-3 text-ink no-underline shadow-card transition duration-150 hover:border-field hover:text-ink active:scale-[0.99] motion-reduce:active:scale-100"
          >
            <span
              aria-hidden="true"
              className="inline-flex size-10 flex-none items-center justify-center rounded-xl bg-subtle text-primary"
            >
              <Icon name={categoryIconName(nudge.categorySlug)} size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                Coming up
              </span>
              <span className="block text-[15px] leading-snug font-semibold">{nudge.headline}</span>
            </span>
            <ArrowRightIcon
              size={18}
              className="flex-none text-muted transition-transform duration-150 group-hover:translate-x-0.5"
            />
          </Link>
        ) : null}
      </div>
      <div
        className="nv-fade-in relative aspect-[16/10] w-full overflow-hidden rounded-panel sm:aspect-auto sm:h-[330px]"
        style={{ backgroundColor: SEASON_ART[season].sky }}
      >
        <HeroArt art={SEASON_ART[season]} />
      </div>
    </div>
  );
}
