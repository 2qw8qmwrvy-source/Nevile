import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn.ts";

/**
 * Grey placeholder block shown while a page streams in. Pulses unless motion is reduced.
 * A `rounded-*` or `bg-*` class replaces the default corner or colour (class names are
 * joined, not merged, so both would otherwise apply and the stylesheet order would win).
 */
export function Skeleton({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        !/(^|\s)rounded-/.test(className) && "rounded-input",
        !/(^|\s)bg-/.test(className) && "bg-subtle",
        "motion-safe:animate-pulse",
        className,
      )}
      style={style}
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

/** Page frame for the shaped skeletons below: same column and padding as real pages. */
function SkeletonPage({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "mx-auto w-full max-w-[1280px] px-4 pt-1 pb-16 sm:px-6 sm:pb-24 lg:px-10",
        className,
      )}
    >
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

/** A white card with a heading line and a few text lines. */
function CardSkeleton({ lines = 3, button = false }: { lines?: number; button?: boolean }) {
  return (
    <div className="rounded-card border border-border bg-surface p-5 shadow-card sm:p-6">
      <Skeleton className="h-6 w-40" />
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows.
          key={index}
          className={cn("mt-3 h-4", index === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
      {button ? <Skeleton className="mt-5 h-12 w-full rounded-full" /> : null}
    </div>
  );
}

/** Lists (bookings, quotes, inbox): a title and a column of row cards. */
export function ListPageSkeleton({
  label = "Loading",
  rows = 4,
}: {
  label?: string;
  rows?: number;
}) {
  return (
    <SkeletonPage label={label}>
      <Skeleton className="h-9 w-56 sm:h-11" />
      <div className="mt-8 grid gap-3">
        <Skeleton className="h-6 w-32" />
        {Array.from({ length: rows }, (_, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows.
            key={index}
            className="flex items-center gap-4 rounded-card border border-border bg-surface p-4 shadow-card"
          >
            <div className="min-w-0 flex-1">
              <Skeleton className="h-5 w-48 max-w-full" />
              <Skeleton className="mt-2 h-4 w-72 max-w-full" />
            </div>
            <Skeleton className="h-7 w-24 rounded-full" />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}

/**
 * Detail and booking pages: a back link, the title, then the main column and a 340px
 * side column on wide screens.
 */
export function DetailPageSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <SkeletonPage label={label}>
      <Skeleton className="mt-3 h-4 w-32" />
      <Skeleton className="mt-5 h-9 w-2/3 max-w-[460px] sm:h-11" />
      <Skeleton className="mt-3 h-5 w-48" />
      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="grid gap-5">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={4} />
        </div>
        <CardSkeleton lines={4} button />
      </div>
    </SkeletonPage>
  );
}

/** Search: the search card, the results heading, then cards beside the map. */
export function SearchPageSkeleton() {
  return (
    <SkeletonPage label="Finding pros">
      <div className="grid gap-3 rounded-card border border-border bg-surface p-4 shadow-card sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto] lg:items-end">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12 lg:w-36" />
        <Skeleton className="h-12 rounded-full lg:w-28" />
      </div>
      <Skeleton className="mt-6 h-8 w-64" />
      <div className="mt-4 flex gap-2 overflow-hidden">
        {[28, 24, 20, 24].map((width) => (
          <Skeleton
            key={width}
            className="h-9 flex-none rounded-full"
            style={{ width: `${width * 4}px` }}
          />
        ))}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:items-start">
        <div className="grid gap-3">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="flex gap-4 rounded-card border border-border bg-surface p-4 shadow-card"
            >
              <Skeleton className="size-14 flex-none rounded-full" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-5 w-48 max-w-full" />
                <Skeleton className="mt-2 h-4 w-40" />
                <Skeleton className="mt-3 h-4 w-full" />
              </div>
            </div>
          ))}
        </div>
        <Skeleton className="hidden rounded-card lg:block lg:h-[calc(100vh-8rem)] lg:max-h-[720px]" />
      </div>
    </SkeletonPage>
  );
}

/** A pro's page: the tinted hero with the logo, then services beside the booking card. */
export function ProPageSkeleton() {
  return (
    <SkeletonPage label="Loading this pro">
      <div className="flex flex-col gap-5 rounded-panel bg-primary-soft px-4.5 py-7 sm:flex-row sm:items-center sm:rounded-hero sm:px-10 sm:py-9">
        <Skeleton className="size-20 flex-none rounded-full bg-surface/70" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-9 w-2/3 max-w-[420px] bg-surface/70 sm:h-11" />
          <Skeleton className="mt-3 h-5 w-48 bg-surface/70" />
          <Skeleton className="mt-3 h-4 w-64 max-w-full bg-surface/70" />
        </div>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="grid gap-6">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </div>
        <CardSkeleton lines={2} button />
      </div>
    </SkeletonPage>
  );
}

/** A conversation: the header, a few message bubbles and the composer. */
export function ChatSkeleton() {
  return (
    <SkeletonPage label="Loading the conversation" className="max-w-3xl pb-6 sm:pb-6">
      <Skeleton className="mt-3 h-4 w-24" />
      <Skeleton className="mt-4 h-8 w-64 max-w-full" />
      <Skeleton className="mt-2 h-4 w-40" />
      <div className="mt-6 grid gap-3 rounded-card border border-border bg-surface p-4 shadow-card">
        <Skeleton className="h-14 w-3/4 rounded-2xl" />
        <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl bg-primary-soft" />
        <Skeleton className="h-20 w-2/3 rounded-2xl" />
        <Skeleton className="ml-auto h-10 w-2/5 rounded-2xl bg-primary-soft" />
        <Skeleton className="mt-3 h-12 w-full rounded-full" />
      </div>
    </SkeletonPage>
  );
}

/**
 * Business tools: the tab bar, a title, then the page's content (a calendar strip, a
 * list or detail cards).
 */
export function BusinessPageSkeleton({
  label = "Loading",
  variant = "cards",
}: {
  label?: string;
  variant?: "calendar" | "list" | "cards";
}) {
  return (
    <SkeletonPage label={label} className="pb-16">
      <div className="mb-6 flex gap-4 overflow-hidden border-b border-border pb-3">
        {[20, 18, 16, 14, 18, 16].map((width, index) => (
          <Skeleton
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder tabs.
            key={index}
            className="h-5 flex-none"
            style={{ width: `${width * 4}px` }}
          />
        ))}
      </div>
      <Skeleton className="h-9 w-56" />
      {variant === "calendar" ? (
        <>
          <div className="mt-5 grid grid-cols-7 gap-2">
            {Array.from({ length: 7 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder days.
              <Skeleton key={index} className="h-20 rounded-card" />
            ))}
          </div>
          <div className="mt-5 grid gap-3">
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
          </div>
        </>
      ) : variant === "list" ? (
        <div className="mt-6 grid gap-3">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="rounded-card border border-border bg-surface p-4 shadow-card">
              <Skeleton className="h-5 w-56 max-w-full" />
              <Skeleton className="mt-2 h-4 w-80 max-w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <div className="grid gap-5">
            <CardSkeleton lines={3} />
            <CardSkeleton lines={3} />
          </div>
          <CardSkeleton lines={4} />
        </div>
      )}
    </SkeletonPage>
  );
}
