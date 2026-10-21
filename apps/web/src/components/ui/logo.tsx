import Link from "next/link";
import { cn } from "@/lib/cn.ts";

type LogoMarkProps = { size?: number; className?: string };

/** House mark with a leaf. The leaf follows the current season when inside a season scope. */
export function LogoMark({ size = 34, className }: LogoMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true" focusable="false" className={className}>
      <rect width="34" height="34" rx="11" fill="var(--nv-primary)" />
      <path
        d="M9 17.5 17 10.5l8 7"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 16.5V24h10v-7.5"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.5 23.2c0-3.2 1.8-5.1 5-5.4-.2 3.1-2 5-5 5.4z"
        style={{ fill: "var(--season-leaf, #BFE0A8)", transition: "fill .35s ease" }}
      />
    </svg>
  );
}

type LogoProps = {
  /** "md" for the header, "sm" for the footer. */
  size?: "sm" | "md";
  className?: string;
  /** Render as a home link (default) or as plain content. */
  link?: boolean;
};

/** The nevile wordmark. */
export function Logo({ size = "md", className, link = true }: LogoProps) {
  const content = (
    <>
      <LogoMark size={size === "md" ? 34 : 30} />
      <span
        className={cn(
          "font-display leading-none font-extrabold tracking-[-0.04em]",
          size === "md" ? "text-[26px]" : "text-[23px]",
        )}
      >
        nevile
      </span>
    </>
  );
  const classes = cn("inline-flex min-h-11 items-center gap-2.5 text-ink no-underline", className);
  if (!link) return <span className={classes}>{content}</span>;
  return (
    <Link href="/" aria-label="Nevile home" className={cn(classes, "rounded-xl hover:text-ink")}>
      {content}
    </Link>
  );
}
