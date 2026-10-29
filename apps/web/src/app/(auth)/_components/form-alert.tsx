import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icons.tsx";
import { cn } from "@/lib/cn.ts";

type FormAlertProps = {
  tone: "error" | "success" | "info";
  children: ReactNode;
  className?: string;
};

const tones = {
  error: { box: "border-danger/30 bg-danger/5 text-danger", icon: "warning" },
  success: { box: "border-primary/25 bg-primary-soft text-primary", icon: "check" },
  info: { box: "border-border bg-ground text-ink", icon: "clock" },
} as const;

/**
 * Inline form message, easing in when it appears. Errors are announced assertively, other
 * messages politely.
 */
export function FormAlert({ tone, children, className }: FormAlertProps) {
  const style = tones[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "nv-pop-in flex items-start gap-2.5 rounded-input border px-3.5 py-3 text-[15px] leading-snug font-medium",
        style.box,
        className,
      )}
    >
      <Icon name={style.icon} size={18} className="mt-px flex-none" />
      <div>{children}</div>
    </div>
  );
}
