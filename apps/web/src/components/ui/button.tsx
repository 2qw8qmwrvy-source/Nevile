import type { Route } from "next";
import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn.ts";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "inverse";
export type ButtonSize = "sm" | "md" | "lg";

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** "pill" (default) or "rounded" (input radius, used next to form fields). */
  shape?: "pill" | "rounded";
  /** Stretch to the container width. */
  block?: boolean;
  className?: string;
  children: ReactNode;
};

type AsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & { href?: undefined };

type AsLink = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps | "href"> & { href: Route };

export type ButtonProps = AsButton | AsLink;

const base =
  "inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap no-underline select-none " +
  "transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-55 " +
  "aria-disabled:pointer-events-none aria-disabled:opacity-55";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover hover:text-on-primary",
  secondary: "bg-surface text-ink border border-field hover:border-primary hover:text-primary-hover",
  ghost: "bg-transparent text-ink hover:bg-hover hover:text-ink",
  inverse: "bg-surface text-primary hover:bg-primary-soft hover:text-primary-hover",
};

// Every size keeps at least a 44px touch target.
const sizes: Record<ButtonSize, string> = {
  sm: "min-h-11 px-4 text-[15px]",
  md: "min-h-11 px-5 text-[15px]",
  lg: "min-h-12 px-6 text-base",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
  shape = "pill",
  block = false,
  className,
}: Omit<CommonProps, "children">): string {
  return cn(
    base,
    variants[variant],
    sizes[size],
    shape === "pill" ? "rounded-full" : "rounded-input",
    block && "w-full",
    className,
  );
}

/** A button, or a Next.js link styled as one when `href` is given. */
export function Button(props: ButtonProps) {
  if (props.href !== undefined) {
    const { variant, size, shape, block, className, children, href, ...rest } = props;
    return (
      <Link href={href} className={buttonClasses({ variant, size, shape, block, className })} {...rest}>
        {children}
      </Link>
    );
  }
  const { variant, size, shape, block, className, children, type, ...rest } = props;
  return (
    <button
      type={type ?? "button"}
      className={buttonClasses({ variant, size, shape, block, className })}
      {...rest}
    >
      {children}
    </button>
  );
}
