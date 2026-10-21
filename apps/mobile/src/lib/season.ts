import { DEFAULT_TIME_ZONE, isValidTimeZone, type Season, seasonFor } from "@nevile/core";

import type { IconName } from "@/components/icon.tsx";

/** The device's IANA zone, falling back to Nevile's default (America/Toronto). */
export function deviceTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && isValidTimeZone(zone)) return zone;
  } catch {
    // Some JS engines lack full Intl support; the default zone is fine for Canada.
  }
  return DEFAULT_TIME_ZONE;
}

export function currentSeason(now: Date = new Date()): Season {
  return seasonFor(now, deviceTimeZone());
}

export function greetingFor(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
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
    message: "Book driveway clearing and salting with a local crew before the next storm.",
    icon: { ios: "snowflake", android: "ac_unit" },
  },
  spring: {
    label: "Spring",
    badge: "Now booking spring visits",
    title: "A fresh start for your yard",
    message: "Spring cleanups, first mows and power-washed patios from pros near you.",
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
