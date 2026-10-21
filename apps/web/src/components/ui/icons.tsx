import type { SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children" | "name"> & {
  /** Pixel size for width and height. Defaults to 20. */
  size?: number;
  /** Accessible name. Without it the icon is decorative and hidden from assistive tech. */
  title?: string;
};

/** Stroke paths on a 24x24 grid, drawn with currentColor. */
const PATHS = {
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  bolt: "M13 2.5 4.5 13.5H12L11 21.5l8.5-11H12z",
  calendar:
    "M5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5zM4 9.5h16M8.5 3v4M15.5 3v4",
  check: "M5 12.5l4.5 4.5L19 7.5",
  chevronDown: "M6 9l6 6 6-6",
  cleaning:
    "M10 3.5l1.6 4.4L16 9.5l-4.4 1.6L10 15.5l-1.6-4.4L4 9.5l4.4-1.6zM17.5 13.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z",
  clock: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 7.5V12l3 2",
  close: "M6 6l12 12M18 6 6 18",
  contract:
    "M5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5zM4 9.5h16M8.5 3v4M15.5 3v4M12 12v6M9.4 13.5l5.2 3M14.6 13.5l-5.2 3",
  dollar:
    "M12 20a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM14.5 9.5c-.5-1-1.4-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1.1 1.6 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1.2 0-2.1-.6-2.6-1.6M12 6.5V8M12 16v1.5",
  gutter:
    "M2.5 10.5 12 4l9.5 6.5M4 11.5h16v1.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM17 15v1.8M17 21a1.6 1.6 0 0 1-1.6-1.6c0-1 1.6-2.4 1.6-2.4s1.6 1.4 1.6 2.4A1.6 1.6 0 0 1 17 21z",
  home: "M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5M10 20v-5.5h4V20",
  lawn: "M20.5 4 17 12M4 12h13.5a1 1 0 0 1 1 1v2.5h-15V13a1 1 0 0 1 1-1zM9 18.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM18.5 18.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0z",
  leaf: "M5 19C5 11 10 5.5 20 4c-.5 9.5-6 15-15 15zM5 19l7.5-7.5",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z",
  menu: "M4 7h16M4 12h16M4 17h16",
  pin: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  pressure: "M3 8.5h7.5l2 2.5H16M7 8.5V14H4.5M18.5 8 21 6.5M18.5 11h3M18.5 14l2.5 1.5",
  repeat:
    "M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19M16 3l3 3-3 3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5M8 21l-3-3 3-3",
  search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4",
  shield: "M12 3 5 6v5.5c0 4.3 3 7.9 7 9.5 4-1.6 7-5.2 7-9.5V6zM9 12l2.2 2.2L15.5 10",
  snow: "M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5",
  sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z",
  sprout: "M12 20.5V12M12 12C12 8.5 9.5 6 5 6c0 3.5 2.5 6 7 6zM12 14.5c0-3 2-5 6-5 0 3-2 5-6 5z",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
  sun: "M12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
  users:
    "M9 11a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zM2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.4c2 .7 3.5 2.6 3.5 5.6",
  warning: "M12 4 2.5 20h19zM12 10v4.5M12 17.5v.01",
  window:
    "M5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4zM12 4v16M4 12h16",
  yard: "M12 2.5V14M5 14h14M6 14v5.5M9.5 14v5.5M12 14v5.5M14.5 14v5.5M18 14v5.5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  title,
  strokeWidth = 2,
  ...rest
}: IconProps & { name: IconName }) {
  const labelled = typeof title === "string" && title.length > 0;
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative unless `title` is given, then it renders <title>.
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      role={labelled ? "img" : undefined}
      aria-hidden={labelled ? undefined : true}
      {...rest}
    >
      {labelled ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}

function named(name: IconName) {
  function NamedIcon(props: IconProps) {
    return <Icon {...props} name={name} />;
  }
  NamedIcon.displayName = `Icon(${name})`;
  return NamedIcon;
}

export const ArrowRightIcon = named("arrowRight");
export const BoltIcon = named("bolt");
export const CalendarIcon = named("calendar");
export const CheckIcon = named("check");
export const ChevronDownIcon = named("chevronDown");
export const CleaningIcon = named("cleaning");
export const ClockIcon = named("clock");
export const CloseIcon = named("close");
export const ContractIcon = named("contract");
export const DollarIcon = named("dollar");
export const GutterIcon = named("gutter");
export const HomeIcon = named("home");
export const LawnIcon = named("lawn");
export const LeafIcon = named("leaf");
export const LockIcon = named("lock");
export const MenuIcon = named("menu");
export const PinIcon = named("pin");
export const PressureIcon = named("pressure");
export const RepeatIcon = named("repeat");
export const SearchIcon = named("search");
export const ShieldIcon = named("shield");
export const SnowIcon = named("snow");
export const SparkleIcon = named("sparkle");
export const SproutIcon = named("sprout");
export const StarIcon = named("star");
export const SunIcon = named("sun");
export const UsersIcon = named("users");
export const WarningIcon = named("warning");
export const WindowIcon = named("window");
export const YardIcon = named("yard");

/** Icon for each service category slug (SPEC §3). Unknown slugs fall back to a house. */
const CATEGORY_ICONS: Record<string, IconName> = {
  "lawn-mowing": "lawn",
  "snow-ice-removal": "snow",
  "house-cleaning": "cleaning",
  "gutter-cleaning": "gutter",
  "leaf-cleanup": "leaf",
  "window-washing": "window",
  "pressure-washing": "pressure",
  "yard-cleanup": "yard",
};

export function categoryIconName(slug: string): IconName {
  return CATEGORY_ICONS[slug] ?? "home";
}

/** Season icon for the switcher and eyebrow. */
export const SEASON_ICONS = {
  winter: "snow",
  spring: "sprout",
  summer: "sun",
  fall: "leaf",
} as const satisfies Record<string, IconName>;
