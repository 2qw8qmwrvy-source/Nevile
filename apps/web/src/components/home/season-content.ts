import type { Season } from "@nevile/tokens";
import type { IconName } from "@/components/ui/icons.tsx";

export type SeasonCopy = {
  label: string;
  eyebrow: string;
  headline: string;
  sub: string;
  note: string;
  noteIcon: IconName;
  tilesTitle: string;
};

/** Hero copy per season (SPEC §13: the hero re-themes by season). */
export const SEASON_COPY: Record<Season, SeasonCopy> = {
  winter: {
    label: "Winter",
    eyebrow: "Winter in Canada",
    headline: "Snow's coming. Book your driveway before the first storm.",
    sub: "Sign a seasonal contract with a local crew: cleared whenever more than 5 cm falls, November to March. Or book a one-off clear when you need it.",
    note: "Seasonal contracts: cleared at 5 cm+, pay per visit",
    noteIcon: "contract",
    tilesTitle: "Popular this winter",
  },
  spring: {
    label: "Spring",
    eyebrow: "Spring in Canada",
    headline: "The snow's gone. Time to get the yard back.",
    sub: "Book a spring cleanup, the first mow of the year or a pressure wash for the winter grime, from local businesses with real reviews and clear prices.",
    note: "Repeat visits: weekly, every 2 weeks or monthly",
    noteIcon: "repeat",
    tilesTitle: "Popular this spring",
  },
  summer: {
    label: "Summer",
    eyebrow: "Summer in Canada",
    headline: "Spend summer at the cottage, not behind the mower.",
    sub: "Put your lawn on a weekly or every-two-weeks schedule, and get the windows, deck and gutters done while you're away.",
    note: "Instant Book: confirmed the moment you pay",
    noteIcon: "bolt",
    tilesTitle: "Popular this summer",
  },
  fall: {
    label: "Fall",
    eyebrow: "Fall in Canada",
    headline: "Leaves down, gutters clear, before the snow flies.",
    sub: "Get leaf cleanup and gutter cleaning done in one weekend, and line up a seasonal snow contract while crews still have room.",
    note: "No Instant Book? Businesses reply within 24 hours",
    noteIcon: "clock",
    tilesTitle: "Popular this fall",
  },
};

/** Illustration palette per season, from the approved mockup. */
export type ArtPalette = {
  sky: string;
  sun: string;
  sunOp: number;
  raysOp: number;
  cloudOp: number;
  hill: string;
  ground: string;
  stripesOp: number;
  walk: string;
  drive: string;
  snowOp: number;
  shrub: string;
  canopy: string;
  canopy2: string;
  canopyOp: number;
  flowersOp: number;
  leavesOp: number;
  window: string;
};

export const SEASON_ART: Record<Season, ArtPalette> = {
  winter: {
    sky: "#CADDEC",
    sun: "#FFFFFF",
    sunOp: 0.85,
    raysOp: 0,
    cloudOp: 0,
    hill: "#EEF4F8",
    ground: "#FFFFFF",
    stripesOp: 0,
    walk: "#B7C3CC",
    drive: "#8D989F",
    snowOp: 1,
    shrub: "#E4ECF1",
    canopy: "#A6D28C",
    canopy2: "#8BC072",
    canopyOp: 0,
    flowersOp: 0,
    leavesOp: 0,
    window: "#F3D58A",
  },
  spring: {
    sky: "#D6E9F1",
    sun: "#F4D27A",
    sunOp: 1,
    raysOp: 0,
    cloudOp: 1,
    hill: "#AFD39B",
    ground: "#88BD6A",
    stripesOp: 0.7,
    walk: "#D8CEBC",
    drive: "#B8BCB4",
    snowOp: 0,
    shrub: "#5E9A4C",
    canopy: "#A6D28C",
    canopy2: "#8BC072",
    canopyOp: 1,
    flowersOp: 1,
    leavesOp: 0,
    window: "#E4EEF3",
  },
  summer: {
    sky: "#F5E0B5",
    sun: "#E5A33A",
    sunOp: 1,
    raysOp: 1,
    cloudOp: 0,
    hill: "#A2C57F",
    ground: "#6EA34E",
    stripesOp: 1,
    walk: "#D8CEBC",
    drive: "#B8BCB4",
    snowOp: 0,
    shrub: "#3E7C39",
    canopy: "#3F7F3A",
    canopy2: "#356E31",
    canopyOp: 1,
    flowersOp: 0,
    leavesOp: 0,
    window: "#E4EEF3",
  },
  fall: {
    sky: "#EFD3C2",
    sun: "#E59A55",
    sunOp: 0.95,
    raysOp: 0,
    cloudOp: 0.85,
    hill: "#D2AE7C",
    ground: "#A4AE5E",
    stripesOp: 0,
    walk: "#D8CEBC",
    drive: "#B8BCB4",
    snowOp: 0,
    shrub: "#9A6A30",
    canopy: "#D9822B",
    canopy2: "#B4451C",
    canopyOp: 1,
    flowersOp: 0,
    leavesOp: 1,
    window: "#F3D58A",
  },
};

/** Example crew-calendar labels per season, for the business band illustration. */
export const SEASON_JOBS: Record<
  Season,
  { jobs: [string, string, string]; times: [string, string, string] }
> = {
  winter: { jobs: ["Snow", "Salting", "Windows"], times: ["6:00", "7:30", "10:00"] },
  spring: { jobs: ["Cleanup", "Mowing", "Wash"], times: ["8:00", "9:30", "1:00"] },
  summer: { jobs: ["Mowing", "Windows", "Gutters"], times: ["8:00", "10:00", "1:30"] },
  fall: { jobs: ["Leaves", "Gutters", "Mowing"], times: ["8:00", "10:30", "1:00"] },
};
