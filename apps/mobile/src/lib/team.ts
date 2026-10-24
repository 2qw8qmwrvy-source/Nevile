/** Team and booking-window helpers for business mode (SPEC §19). */
import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { ARRIVAL_WINDOW_LIMITS } from "@nevile/core";

export type TeamMember = inferRouterOutputs<AppRouter>["team"]["members"][number];

export const WEEKDAYS = [
  { weekday: 1, label: "Monday" },
  { weekday: 2, label: "Tuesday" },
  { weekday: 3, label: "Wednesday" },
  { weekday: 4, label: "Thursday" },
  { weekday: 5, label: "Friday" },
  { weekday: 6, label: "Saturday" },
  { weekday: 0, label: "Sunday" },
] as const;

/** Times step by the same amount as arrival windows. */
export const TIME_STEP = ARRIVAL_WINDOW_LIMITS.stepMinutes * 2;
/** 5 am to 11 pm for working hours. */
export const HOURS_RANGE = { min: 300, max: 1380 } as const;
/** Arrival windows stay within 6 am to 9 pm. */
export const WINDOW_RANGE = {
  min: ARRIVAL_WINDOW_LIMITS.earliestMinute,
  max: ARRIVAL_WINDOW_LIMITS.latestMinute,
} as const;

export const dateLabel = new Intl.DateTimeFormat("en-CA", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

/** "Mon–Fri" style summary of weekly hours. */
export function hoursSummary(member: Pick<TeamMember, "hours">): string {
  if (member.hours.length === 0) return "No working hours set";
  return `Works ${member.hours.length} ${member.hours.length === 1 ? "day" : "days"} a week`;
}
