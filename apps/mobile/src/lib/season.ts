import { type Season, type SeasonNudge, seasonFor, seasonNudgeFor } from "@nevile/core";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import type { IconName } from "@/components/icon.tsx";

/**
 * SPEC §13: the season follows the current month in Nova Scotia (America/Halifax), never
 * the device's zone or a manual choice, so everyone sees the same season on the same day.
 */
export function currentSeason(now: Date = new Date()): Season {
  return seasonFor(now);
}

/** The "what's next" nudge in the last month of a season (Mar, May, Aug, Nov), else null. */
export function currentNudge(now: Date = new Date()): SeasonNudge | null {
  return seasonNudgeFor(now);
}

/** Greeting by the device's local hour: it is about the person, not the season. */
export function greetingFor(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export type SeasonNow = { season: Season; nudge: SeasonNudge | null; greeting: string };

function seasonNow(now: Date = new Date()): SeasonNow {
  return { season: currentSeason(now), nudge: currentNudge(now), greeting: greetingFor(now) };
}

/**
 * The season, nudge and greeting for now, re-read whenever the app returns to the
 * foreground so an app left open across a month boundary re-themes on its own.
 */
export function useSeasonNow(): SeasonNow {
  const [state, setState] = useState(seasonNow);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      if (status !== "active") return;
      const next = seasonNow();
      setState((current) =>
        current.season === next.season &&
        current.nudge?.key === next.nudge?.key &&
        current.greeting === next.greeting
          ? current
          : next,
      );
    });
    return () => subscription.remove();
  }, []);
  return state;
}

export type SeasonCopy = {
  label: string;
  badge: string;
  title: string;
  message: string;
  icon: IconName;
};

export const SEASON_COPY: Record<Season, SeasonCopy> = {
  winter: {
    label: "Winter",
    badge: "Now booking winter visits",
    title: "Snow day? Sorted.",
    message: "Driveway clearing and salting from a local crew, before the next nor'easter.",
    icon: { ios: "snowflake", android: "ac_unit" },
  },
  spring: {
    label: "Spring",
    badge: "Now booking spring visits",
    title: "A fresh start for your yard",
    message: "Spring cleanups, first mows and power-washed decks from pros near you.",
    icon: { ios: "camera.macro", android: "local_florist" },
  },
  summer: {
    label: "Summer",
    badge: "Now booking summer visits",
    title: "Long days, less yard work",
    message: "Weekly mowing, sparkling windows and a clean deck, booked in a few taps.",
    icon: { ios: "sun.max.fill", android: "wb_sunny" },
  },
  fall: {
    label: "Fall",
    badge: "Now booking fall visits",
    title: "Get ahead of the leaves",
    message: "Leaf cleanup and gutter clearing before the first snow, from crews nearby.",
    icon: { ios: "leaf.fill", android: "eco" },
  },
};

/** Button label for each nudge (the headline itself comes from @nevile/core). */
export const NUDGE_ACTIONS: Record<SeasonNudge["key"], string> = {
  "snow-contract": "Find snow removal",
  "spring-yard-cleanup": "Find yard cleanup",
  "lawn-mowing-season": "Find lawn mowing",
  "fall-gutter-cleanup": "Find gutter cleaning",
};
