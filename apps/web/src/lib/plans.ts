import { BUSINESS_FEE_BPS, formatBasisPoints, formatCad } from "@nevile/core";

/**
 * Pro plan list price shown on marketing pages (SPEC §8: ~$29/month, admin-configurable).
 * Checkout always uses the server-side plan price, never this constant.
 */
export const PRO_PLAN_MONTHLY_CENTS = 2900;

/** "$29" for whole-dollar amounts, otherwise "$29.50". */
export function formatPlanPrice(cents: number): string {
  const formatted = formatCad(cents);
  return formatted.endsWith(".00") ? formatted.slice(0, -3) : formatted;
}

/** The business fee as shown in copy, e.g. "3%". */
export const BUSINESS_FEE_LABEL = formatBasisPoints(BUSINESS_FEE_BPS);
