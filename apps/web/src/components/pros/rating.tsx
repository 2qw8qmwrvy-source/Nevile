import { StarIcon } from "@/components/ui/icons.tsx";
import { cn } from "@/lib/cn.ts";

type RatingProps = {
  rating: { average: number; count: number } | null;
  className?: string;
};

/** "★ 4.8 (12 reviews)", or "New on Nevile" before the first review (SPEC §18). */
export function Rating({ rating, className }: RatingProps) {
  if (!rating) {
    return <span className={cn("text-sm font-medium text-muted", className)}>New on Nevile</span>;
  }
  const reviews = `${rating.count} ${rating.count === 1 ? "review" : "reviews"}`;
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm", className)}>
      <span className="sr-only">
        Rated {rating.average.toFixed(1)} out of 5 from {reviews}
      </span>
      <StarIcon size={16} className="fill-star text-star" />
      <span aria-hidden="true" className="font-semibold">
        {rating.average.toFixed(1)}
      </span>
      <span aria-hidden="true" className="text-muted">
        ({reviews})
      </span>
    </span>
  );
}
