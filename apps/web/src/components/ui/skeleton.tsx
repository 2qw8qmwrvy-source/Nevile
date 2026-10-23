import { cn } from "@/lib/cn.ts";

/** Grey placeholder block shown while a page streams in. Pulses unless motion is reduced. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("rounded-input bg-subtle motion-safe:animate-pulse", className)}
    />
  );
}

/**
 * Generic page placeholder: a season-tinted hero and two cards, matching the layout of
 * most pages so nothing jumps when the real content arrives (SPEC §16).
 */
export function PageSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto w-full max-w-[1280px] px-4 pt-1 pb-16 sm:px-6 lg:px-10"
    >
      <span className="sr-only">{label}…</span>
      <div className="rounded-panel bg-season-tint px-4.5 py-8 sm:rounded-hero sm:px-11 sm:py-11">
        <Skeleton className="h-4 w-32 bg-surface/70" />
        <Skeleton className="mt-4 h-10 w-3/4 max-w-[520px] bg-surface/70" />
        <Skeleton className="mt-3 h-5 w-2/3 max-w-[420px] bg-surface/70" />
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-surface p-6">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-4 h-4 w-full" />
          <Skeleton className="mt-2.5 h-4 w-5/6" />
          <Skeleton className="mt-2.5 h-4 w-2/3" />
        </div>
        <div className="rounded-card border border-border bg-surface p-6">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-4 h-4 w-full" />
          <Skeleton className="mt-2.5 h-4 w-4/5" />
          <Skeleton className="mt-5 h-12 w-full rounded-full" />
        </div>
      </div>
    </div>
  );
}
