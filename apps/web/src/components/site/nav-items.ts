import type { Route } from "next";

export type NavItem = { href: Route; label: string };

export const mainNav: readonly NavItem[] = [
  { href: "/#services", label: "Services" },
  { href: "/#how", label: "How it works" },
  { href: "/for-businesses", label: "For businesses" },
];
