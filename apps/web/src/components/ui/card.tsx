import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn.ts";

type CardProps = HTMLAttributes<HTMLElement> & {
  /** Inner padding preset. */
  padding?: "none" | "sm" | "md" | "lg";
  as?: "div" | "section" | "article" | "aside" | "li";
};

const paddings = { none: "", sm: "p-4", md: "p-5 sm:p-6", lg: "p-6 sm:p-8" } as const;

/** White surface with the Seasons 18px card radius, hairline border and soft shadow. */
export function Card({ padding = "md", as: Tag = "div", className, ...rest }: CardProps) {
  return (
    <Tag
      className={cn(
        "rounded-card border border-border bg-surface text-ink shadow-card",
        paddings[padding],
        className,
      )}
      {...rest}
    />
  );
}
