/**
 * Nevile Neighbours, the community program — SPEC §15.
 *
 * - Partner referrals only, with minimal data: homeowner first name, a contact route
 *   through the partner, the job address (Nova Scotia), the service needed, preferred
 *   timing and the partner's confirmation that the homeowner consented. No health,
 *   disability, age or income details are collected.
 * - Admin approves or declines each referral; approved referrals are booked with Nevile
 *   pros at their normal price and run like any other booking.
 * - The fund balance is derived from an append-only ledger, never stored.
 * - The public impact page shows totals by region, and a region only once it has at least
 *   3 completed jobs.
 */
import { z } from "zod";
import { CATEGORY_SLUGS } from "./categories.ts";
import { launchPostalCodeSchema } from "./region.ts";

export const NS_REGIONS = [
  {
    id: "halifax-regional-municipality",
    name: "Halifax Regional Municipality",
    description: "Halifax, Dartmouth, Bedford, Sackville and surrounding communities",
  },
  {
    id: "cape-breton",
    name: "Cape Breton",
    description: "Cape Breton Island, including Sydney, Glace Bay and Port Hawkesbury",
  },
  {
    id: "annapolis-valley",
    name: "Annapolis Valley",
    description: "Kings, Annapolis and West Hants, including Kentville, Wolfville and Windsor",
  },
  {
    id: "south-shore",
    name: "South Shore",
    description: "Lunenburg, Queens and Shelburne counties, including Bridgewater and Liverpool",
  },
  {
    id: "northern-nova-scotia",
    name: "Northern Nova Scotia",
    description: "Truro, Colchester, Cumberland and Pictou",
  },
  {
    id: "eastern-nova-scotia",
    name: "Eastern Nova Scotia",
    description: "Antigonish, Guysborough and the Eastern Shore",
  },
  {
    id: "yarmouth-acadian-shores",
    name: "Yarmouth & Acadian Shores",
    description: "Yarmouth and Digby counties, including Clare and Argyle",
  },
] as const;

export type NsRegion = (typeof NS_REGIONS)[number];
export type NsRegionId = NsRegion["id"];

export const NS_REGION_IDS: readonly NsRegionId[] = NS_REGIONS.map((region) => region.id);

export function isNsRegionId(value: unknown): value is NsRegionId {
  return typeof value === "string" && (NS_REGION_IDS as readonly string[]).includes(value);
}

export function nsRegion(id: NsRegionId): NsRegion {
  const region = NS_REGIONS.find((candidate) => candidate.id === id);
  if (!region) throw new RangeError(`unknown region "${String(id)}"`);
  return region;
}

// --- Referrals ---------------------------------------------------------------------------

export const REFERRAL_STATUSES = [
  "pending",
  "approved",
  "declined",
  "booked",
  "completed",
  "cancelled",
] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

/**
 * Allowed status changes:
 * - pending → approved / declined (admin review), or cancelled (partner withdraws);
 * - approved → booked (a pro is booked from the fund), or cancelled;
 * - booked → completed, cancelled, or back to approved when the booking falls through
 *   (e.g. the business cancels) so it can be booked again;
 * - declined, completed and cancelled are final.
 */
export const REFERRAL_TRANSITIONS: Readonly<Record<ReferralStatus, readonly ReferralStatus[]>> = {
  pending: ["approved", "declined", "cancelled"],
  approved: ["booked", "cancelled"],
  booked: ["completed", "approved", "cancelled"],
  declined: [],
  completed: [],
  cancelled: [],
};

export function isReferralStatus(value: unknown): value is ReferralStatus {
  return typeof value === "string" && (REFERRAL_STATUSES as readonly string[]).includes(value);
}

export function canTransitionReferral(from: ReferralStatus, to: ReferralStatus): boolean {
  if (!isReferralStatus(from) || !isReferralStatus(to)) return false;
  return REFERRAL_TRANSITIONS[from].includes(to);
}

/** Throws unless `from → to` is an allowed referral status change. */
export function assertReferralTransition(from: ReferralStatus, to: ReferralStatus): void {
  if (!canTransitionReferral(from, to)) {
    throw new RangeError(`referral cannot go from "${String(from)}" to "${String(to)}"`);
  }
}

export function isFinalReferralStatus(status: ReferralStatus): boolean {
  return REFERRAL_TRANSITIONS[status].length === 0;
}

export const REFERRAL_FIRST_NAME_MAX_LENGTH = 60;
export const REFERRAL_CONTACT_ROUTE_MAX_LENGTH = 200;
export const REFERRAL_ADDRESS_LINE_MAX_LENGTH = 200;
export const REFERRAL_CITY_MAX_LENGTH = 100;
export const REFERRAL_TIMING_MAX_LENGTH = 200;
export const REFERRAL_NOTES_MAX_LENGTH = 1000;

/** Hint for the notes field; shown to partners and attached to the schema. */
export const REFERRAL_NOTES_HINT =
  "Practical details only, like access or parking. Please don't include health, disability, age or income details.";

const requiredText = (max: number) => z.string().trim().min(1, "Required").max(max);

/** Optional free text: trimmed, and dropped when empty. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

/**
 * A partner's referral. Strict: unknown fields are rejected rather than stored, so no
 * extra personal details can slip in.
 */
export const referralInputSchema = z.strictObject({
  homeownerFirstName: requiredText(REFERRAL_FIRST_NAME_MAX_LENGTH),
  /** How to reach the homeowner through the partner, e.g. "Call Mary at the centre". */
  contactRoute: requiredText(REFERRAL_CONTACT_ROUTE_MAX_LENGTH),
  addressLine: requiredText(REFERRAL_ADDRESS_LINE_MAX_LENGTH),
  city: requiredText(REFERRAL_CITY_MAX_LENGTH),
  postalCode: launchPostalCodeSchema,
  regionId: z.enum(NS_REGION_IDS),
  categorySlug: z.enum(CATEGORY_SLUGS),
  preferredTiming: optionalText(REFERRAL_TIMING_MAX_LENGTH),
  // Free text cannot be screened reliably, so nothing is rejected here; the hint (shown
  // in the form) asks partners to leave out health, disability, age and income details.
  notes: optionalText(REFERRAL_NOTES_MAX_LENGTH).describe(REFERRAL_NOTES_HINT),
  consentConfirmed: z.literal(true, {
    message: "Confirm that the homeowner agreed to this referral",
  }),
});
export type ReferralInput = z.input<typeof referralInputSchema>;
export type Referral = z.output<typeof referralInputSchema>;

// --- Impact ------------------------------------------------------------------------------

export const LEDGER_ENTRY_KINDS = ["donation", "fee", "payout", "refund", "adjustment"] as const;
export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];

/**
 * One append-only fund ledger row. `amountCents` is signed from the fund's point of view:
 * money in is positive (donations), money out is negative (card fees, payouts to pros,
 * donation refunds). A reversal is a row of the same kind with the opposite sign.
 */
export type LedgerEntry = { kind: LedgerEntryKind; amountCents: number };

export type LedgerSummary = {
  /** Donations received (net of reversals). */
  donatedCents: number;
  /** Card fees deducted from donations, as a positive amount. */
  feesCents: number;
  /** Paid to pros for referral jobs, as a positive amount. */
  paidToProsCents: number;
  /** Donations refunded to customers, as a positive amount. */
  refundedCents: number;
  /** The fund balance: the sum of every row, adjustments included. */
  balanceCents: number;
};

/** Totals for the impact page and the fund balance, derived from the ledger. */
export function summarizeLedger(entries: Iterable<Readonly<LedgerEntry>>): LedgerSummary {
  const totals: Record<LedgerEntryKind, number> = {
    donation: 0,
    fee: 0,
    payout: 0,
    refund: 0,
    adjustment: 0,
  };
  let index = 0;
  for (const entry of entries) {
    if (!(LEDGER_ENTRY_KINDS as readonly string[]).includes(entry.kind)) {
      throw new RangeError(`entries[${index}]: unknown ledger kind "${String(entry.kind)}"`);
    }
    if (!Number.isSafeInteger(entry.amountCents)) {
      throw new RangeError(`entries[${index}]: amountCents must be an integer number of cents`);
    }
    totals[entry.kind] += entry.amountCents;
    index++;
  }
  const balanceCents =
    totals.donation + totals.fee + totals.payout + totals.refund + totals.adjustment;
  if (!Number.isSafeInteger(balanceCents)) throw new RangeError("ledger total out of range");
  // `0 - x` rather than `-x` so an empty total is 0, not -0.
  return {
    donatedCents: totals.donation,
    feesCents: 0 - totals.fee,
    paidToProsCents: 0 - totals.payout,
    refundedCents: 0 - totals.refund,
    balanceCents,
  };
}

/** A region appears on the public impact page only from this many completed jobs. */
export const PUBLIC_REGION_MIN_COMPLETED_JOBS = 3;

export type PublicRegionImpact = {
  regionId: NsRegionId;
  name: string;
  completedJobs: number;
};

/**
 * Regions to show on the public impact page, in `NS_REGIONS` order: those with at least
 * `min` completed jobs. Regions under the threshold are left out entirely.
 */
export function publicRegions(
  completedJobsByRegion: Readonly<Partial<Record<NsRegionId, number>>>,
  min: number = PUBLIC_REGION_MIN_COMPLETED_JOBS,
): PublicRegionImpact[] {
  if (!Number.isSafeInteger(min) || min < 1) {
    throw new RangeError(`min must be a positive integer, got ${String(min)}`);
  }
  for (const [regionId, count] of Object.entries(completedJobsByRegion)) {
    if (!isNsRegionId(regionId)) throw new RangeError(`unknown region "${regionId}"`);
    if (count !== undefined && (!Number.isSafeInteger(count) || count < 0)) {
      throw new RangeError(`${regionId}: completed jobs must be a non-negative integer`);
    }
  }
  const visible: PublicRegionImpact[] = [];
  for (const region of NS_REGIONS) {
    const completedJobs = completedJobsByRegion[region.id] ?? 0;
    if (completedJobs >= min) {
      visible.push({ regionId: region.id, name: region.name, completedJobs });
    }
  }
  return visible;
}
