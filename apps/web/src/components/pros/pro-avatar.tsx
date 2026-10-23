import { cn } from "@/lib/cn.ts";

/** "Harbour Lawn & Snow" → "HL". */
function initialsOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}

type ProAvatarProps = {
  name: string;
  logoUrl: string | null;
  size?: "md" | "lg";
  className?: string;
};

/** A business's logo, or its initials on a soft tile when it has none. */
export function ProAvatar({ name, logoUrl, size = "md", className }: ProAvatarProps) {
  const box = size === "lg" ? "size-20 rounded-[22px] text-2xl" : "size-14 rounded-2xl text-lg";
  if (logoUrl) {
    return (
      // biome-ignore lint/performance/noImgElement: media is already resized WebP; next/image would re-process it.
      <img
        src={logoUrl}
        alt=""
        width={size === "lg" ? 80 : 56}
        height={size === "lg" ? 80 : 56}
        className={cn(box, "flex-none border border-border bg-surface object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        box,
        "inline-flex flex-none items-center justify-center bg-primary-soft font-display font-bold text-primary",
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
