import type { Route } from "next";

export type NavItem = { href: Route; label: string };

export const mainNav: readonly NavItem[] = [
  { href: "/search", label: "Find a pro" },
  { href: "/#how", label: "How it works" },
  { href: "/for-businesses", label: "For businesses" },
];
