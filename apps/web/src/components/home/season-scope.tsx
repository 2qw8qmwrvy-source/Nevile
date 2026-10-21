"use client";

import type { Season } from "@nevile/tokens";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { seasonCssVars, seasonLeaf } from "@/lib/theme.ts";

type SeasonState = {
  season: Season;
  setSeason: (season: Season) => void;
  /** Category slug selected in the search card; follows the season until the user picks one. */
  service: string;
  setService: (slug: string) => void;
};

const SeasonContext = createContext<SeasonState | null>(null);

export function useSeason(): SeasonState {
  const value = useContext(SeasonContext);
  if (!value) throw new Error("useSeason must be used inside <SeasonScope>");
  return value;
}

type SeasonScopeProps = {
  initialSeason: Season;
  /** Featured category slugs per season; the first one pre-selects the search card. */
  featured: Readonly<Record<Season, readonly string[]>>;
  /** Fallback slug when a season has no featured categories. */
  fallbackService: string;
  className?: string;
  children: ReactNode;
};

/**
 * Holds the selected season for the homepage and exposes it as --season-* CSS variables,
 * so server-rendered children re-theme through `bg-season-tint`, `text-season-ink` etc.
 */
export function SeasonScope({
  initialSeason,
  featured,
  fallbackService,
  className,
  children,
}: SeasonScopeProps) {
  const [season, setSeasonState] = useState<Season>(initialSeason);
  const [service, setService] = useState<string>(featured[initialSeason][0] ?? fallbackService);

  const value = useMemo<SeasonState>(
    () => ({
      season,
      service,
      setService,
      setSeason(next) {
        setSeasonState(next);
        setService(featured[next][0] ?? fallbackService);
      },
    }),
    [season, service, featured, fallbackService],
  );

  // Let the header logo (outside this scope) pick up the season's leaf colour.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--season-leaf", seasonLeaf[season]);
    return () => root.style.removeProperty("--season-leaf");
  }, [season]);

  return (
    <SeasonContext.Provider value={value}>
      <div data-season={season} style={seasonCssVars(season)} className={className}>
        {children}
      </div>
    </SeasonContext.Provider>
  );
}
