import { cn } from "@/lib/cn.ts";

const TONES: Record<string, string> = {
  requested: "bg-season-tint text-season-ink",
  confirmed: "bg-primary-soft text-primary",
  completed_pending_confirmation: "bg-season-tint text-season-ink",
  disputed: "bg-danger/10 text-danger",
  fix_scheduled: "bg-season-tint text-season-ink",
  completed: "bg-ground text-ink border border-border",
};

/** A booking's status as a small pill. */
export function StatusPill({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 flex-none items-center rounded-full px-3 text-xs font-semibold whitespace-nowrap",
        TONES[status] ?? "bg-ground text-muted border border-border",
      )}
    >
      {label}
    </span>
  );
}
