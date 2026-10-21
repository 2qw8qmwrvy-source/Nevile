import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn.ts";

type ContainerProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "header" | "footer" | "main" | "nav";
};

/** Centred 1280px column with 16px gutters on phones and 40px on desktop. */
export function Container({ as: Tag = "div", className, ...rest }: ContainerProps) {
  return <Tag className={cn("mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-10", className)} {...rest} />;
}
