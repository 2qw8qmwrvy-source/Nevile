import type { ReactNode } from "react";
import { cn } from "@/lib/cn.ts";
import { Icon, type IconName } from "./icons.tsx";

export type BadgeVariant = "verified" | "pro" | "instant" | "neutral" | "season";

const styles: Record<BadgeVariant, string> = {
  verified: "bg-primary-soft text-primary",
  pro: "bg-ink text-white tracking-[0.03em]",
  instant: "bg-surface text-primary border border-border",
  neutral: "bg-ground text-ink border border-border",
  season: "bg-season-tint text-season-ink",
};

const defaults: Record<BadgeVariant, { label?: string; icon?: IconName; title?: string }> = {
  verified: { label: "Verified", icon: "shield", title: "Insurance checked by Nevile" },
  pro: { label: "Pro", title: "Subscribed business, shown first" },
  instant: { label: "Instant Book", icon: "bolt", title: "Confirmed the moment you pay" },
  neutral: {},
  season: {},
};

type BadgeProps = {
  variant?: BadgeVariant;
  /** Overrides the variant's default label. */
  children?: ReactNode;
  icon?: IconName | null;
  className?: string;
};

/** Small status pill. Verified, Pro and Instant Book come with their standard label. */
export function Badge({ variant = "neutral", children, icon, className }: BadgeProps) {
  const preset = defaults[variant];
  const iconName = icon === null ? undefined : (icon ?? preset.icon);
  return (
    <span
      title={preset.title}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full text-xs font-semibold whitespace-nowrap",
        iconName ? "pr-2 pl-1.5" : "px-2.5",
        styles[variant],
        className,
      )}
    >
      {iconName ? <Icon name={iconName} size={14} /> : null}
      {children ?? preset.label}
    </span>
  );
}
