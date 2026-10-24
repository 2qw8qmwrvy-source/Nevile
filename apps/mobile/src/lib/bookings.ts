/**
 * Customer bookings in the app (SPEC §19): the list and detail screens share these types and
 * the status colours. Booking and paying live in `app/book.tsx`.
 */
import type { AppRouter, inferRouterOutputs } from "@nevile/api";

import { colors, seasons } from "@/theme";

export type BookingList = inferRouterOutputs<AppRouter>["bookings"]["list"];
export type CustomerBooking = BookingList["upcoming"][number];

/** Pill colours by status; anything not listed (cancelled, expired…) is neutral. */
const STATUS_COLORS: Record<string, { background: string; text: string }> = {
  requested: { background: seasons.summer.tint, text: colors.ink },
  confirmed: { background: seasons.spring.tint, text: colors.primary },
  completed_pending_confirmation: { background: seasons.summer.tint, text: colors.ink },
  disputed: { background: "#FBE4E2", text: colors.danger },
  fix_scheduled: { background: seasons.summer.tint, text: colors.ink },
};

export function statusColors(status: string): { background: string; text: string } {
  return STATUS_COLORS[status] ?? { background: colors.ground, text: colors.muted };
}

/** "Monday, November 2 at 3:00 p.m." in Nova Scotia time. */
export const deadlineFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Halifax",
  weekday: "long",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
