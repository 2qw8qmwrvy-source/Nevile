/**
 * Nevile Neighbours copy (SPEC §15). Soft, accurate claims only: no fixed percentage and
 * no promised outcome. Amounts come from @nevile/core so the examples match the rules.
 */
import {
  DONATION_CARD_FEE_BPS,
  DONATION_MAX_CENTS,
  DONATION_MIN_CENTS,
  DONATION_PRESETS_CENTS,
  donationBreakdown,
  formatBasisPoints,
  formatCad,
} from "@nevile/core";

import type { IconName } from "@/components/icon.tsx";

const example = donationBreakdown(DONATION_PRESETS_CENTS[0]);
const presets = DONATION_PRESETS_CENTS.map((cents) => formatCad(cents).replace(/\.00$/, ""));
const whole = (cents: number) => formatCad(cents).replace(/\.00$/, "");

export const NEIGHBOURS_COPY = {
  name: "Nevile Neighbours",
  icon: { ios: "heart.circle", android: "volunteer_activism" } as IconName,
  pitch:
    "We're setting aside donations from our community to help neighbours who can't keep up with their homes.",
  launchingSoon:
    "Nevile Neighbours is launching soon. Donations and referrals open once we've finalised how donated money is held.",
  steps: [
    {
      title: "Optional donations at checkout",
      body: `Round up to the next dollar, or give ${presets.join(" or ")}, or any amount from ${whole(DONATION_MIN_CENTS)} to ${whole(DONATION_MAX_CENTS)}. Nothing is pre-selected, and Nevile's own fee is never used.`,
    },
    {
      title: "Card fees shown openly",
      body: `The card processor's ${formatBasisPoints(DONATION_CARD_FEE_BPS)} comes out of each donation: ${formatCad(example.amountCents)} donated is ${formatCad(example.feeCents)} in fees and ${formatCad(example.netCents)} to the fund.`,
    },
    {
      title: "Referred by local organizations",
      body: "Seniors' centres, community support agencies and faith groups refer neighbours who need a hand. Nevile reviews each referral.",
    },
    {
      title: "Local pros, paid in full",
      body: "Yard work, snow clearing or cleaning is booked with Nevile pros at their normal price, paid from the fund.",
    },
  ],
  privacy:
    "The impact page never shows names or addresses, and a region only appears once it has a few completed jobs.",
} as const;
