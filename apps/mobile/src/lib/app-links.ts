/**
 * Notifications and pushes carry website paths (SPEC §20). This opens the matching app
 * screen, or the website for anything the app doesn't have.
 */
import { type Href, router } from "expo-router";

import { openWebsitePage } from "./links.ts";

const ID = "([0-9a-f-]{36})";

/** Business pages pass the business as `?b=<id>` on the website. */
type Match = { id: string; businessId?: string };

const ROUTES: ReadonlyArray<[RegExp, (match: Match) => Href]> = [
  [
    new RegExp(`^/quotes/${ID}$`),
    ({ id }) => ({ pathname: "/quotes/[groupId]", params: { groupId: id } }),
  ],
  [/^\/quotes$/, () => "/quotes"],
  [
    new RegExp(`^/inbox/${ID}$`),
    ({ id }) => ({ pathname: "/inbox/[conversationId]", params: { conversationId: id } }),
  ],
  [/^\/inbox$/, () => "/inbox"],
  [new RegExp(`^/bookings/${ID}$`), ({ id }) => ({ pathname: "/bookings/[id]", params: { id } })],
  [/^\/bookings$/, () => "/bookings"],
  [
    new RegExp(`^/business/quotes/${ID}$`),
    ({ id, businessId }) => ({
      pathname: "/business/quotes/[requestId]",
      params: { requestId: id, ...(businessId ? { businessId } : {}) },
    }),
  ],
  [
    /^\/business\/quotes$/,
    ({ businessId }) => ({
      pathname: "/business/quotes",
      params: businessId ? { businessId } : {},
    }),
  ],
  [
    /^\/business\/calendar$/,
    ({ businessId }) => ({
      pathname: "/business/calendar",
      params: businessId ? { businessId } : {},
    }),
  ],
  [
    /^\/business\/payouts$/,
    ({ businessId }) => ({
      pathname: "/business/payouts",
      params: businessId ? { businessId } : {},
    }),
  ],
  [
    /^\/business\/team$/,
    ({ businessId }) => ({ pathname: "/business/team", params: businessId ? { businessId } : {} }),
  ],
  [
    /^\/business$/,
    ({ businessId }) => ({ pathname: "/business", params: businessId ? { businessId } : {} }),
  ],
];

/** The app screen for a website path, or null when it only exists on the website. */
export function appHrefFor(path: string): Href | null {
  const [pathname = "", query = ""] = path.split("#")[0]?.split("?") ?? [];
  const b = new URLSearchParams(query).get("b");
  const businessId = b && /^[0-9a-f-]{36}$/.test(b) ? b : undefined;
  for (const [pattern, href] of ROUTES) {
    const match = pathname.match(pattern);
    if (match) return href({ id: match[1] ?? "", businessId });
  }
  return null;
}

export function openPath(path: string): void {
  if (!path.startsWith("/")) return;
  const href = appHrefFor(path);
  if (href) router.push(href);
  else void openWebsitePage(path);
}
