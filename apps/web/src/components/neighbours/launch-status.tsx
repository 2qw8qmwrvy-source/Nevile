import { ClockIcon, HeartIcon } from "@/components/ui/icons.tsx";

/** "Launching soon" while NEVILE_NEIGHBOURS_ENABLED is off (SPEC §15). */
export function LaunchStatus({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-sm font-semibold text-on-primary">
      <HeartIcon size={16} /> Now open
    </span>
  ) : (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm font-semibold text-ink">
      <ClockIcon size={16} /> Launching soon
    </span>
  );
}
