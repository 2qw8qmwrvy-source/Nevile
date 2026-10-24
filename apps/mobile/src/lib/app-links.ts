/**
 * Notifications and pushes carry website paths (SPEC §20). This opens the matching app
 * screen, or the website for anything the app doesn't have yet.
 */
import { type Href, router } from "expo-router";

import { openWebsitePage } from "./links.ts";

const ID = "([0-9a-f-]{36})";

const ROUTES: ReadonlyArray<[RegExp, (id: string) => Href]> = [
  [
    new RegExp(`^/quotes/${ID}$`),
    (groupId) => ({ pathname: "/quotes/[groupId]", params: { groupId } }),
  ],
  [/^\/quotes$/, () => "/quotes"],
  [
    new RegExp(`^/inbox/${ID}$`),
    (conversationId) => ({ pathname: "/inbox/[conversationId]", params: { conversationId } }),
  ],
  [/^\/inbox$/, () => "/inbox"],
  [new RegExp(`^/bookings/${ID}$`), (id) => ({ pathname: "/bookings/[id]", params: { id } })],
  [/^\/bookings$/, () => "/bookings"],
];

/** The app screen for a website path, or null when it only exists on the website. */
export function appHrefFor(path: string): Href | null {
  const pathname = path.split(/[?#]/)[0] ?? "";
  for (const [pattern, href] of ROUTES) {
    const match = pathname.match(pattern);
    if (match) return href(match[1] ?? "");
  }
  return null;
}

export function openPath(path: string): void {
  if (!path.startsWith("/")) return;
  const href = appHrefFor(path);
  if (href) router.push(href);
  else void openWebsitePage(path);
}
