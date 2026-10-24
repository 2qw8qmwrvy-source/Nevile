/** Quote requests in the app (SPEC §20): shared types, status colours and date formats. */
import type { AppRouter, inferRouterOutputs } from "@nevile/api";

import { colors, seasons } from "@/theme";

export type QuoteGroup = inferRouterOutputs<AppRouter>["quotes"]["get"];

const STATUS_COLORS: Record<string, { background: string; text: string }> = {
  quoted: { background: seasons.spring.tint, text: colors.primary },
  accepted: { background: seasons.spring.tint, text: colors.primary },
  open: { background: seasons.summer.tint, text: colors.ink },
};

export function quoteStatusColors(status: string): { background: string; text: string } {
  return STATUS_COLORS[status] ?? { background: colors.ground, text: colors.muted };
}

/** "Monday, November 2, 3:00 p.m." in Nova Scotia time. */
export const quoteWhen = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Halifax",
  weekday: "long",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export const shortDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Halifax",
  month: "short",
  day: "numeric",
});
