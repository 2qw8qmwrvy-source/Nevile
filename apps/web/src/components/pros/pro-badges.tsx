import { Badge } from "@/components/ui/badge.tsx";

type ProBadgesProps = {
  badges: { verified: boolean; pro: boolean; instantBook: boolean };
};

/** Verified, Pro and Instant Book badges; Pro also discloses the search boost (SPEC §18). */
export function ProBadges({ badges }: ProBadgesProps) {
  if (!badges.verified && !badges.pro && !badges.instantBook) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {badges.pro ? <Badge variant="pro" /> : null}
      {badges.verified ? <Badge variant="verified" /> : null}
      {badges.instantBook ? <Badge variant="instant" /> : null}
    </span>
  );
}
