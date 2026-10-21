import "server-only";
import { auth, type Session, safeRedirectPath } from "@nevile/auth";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";

/** The signed-in session for this request, read once and shared by layout and page. */
export const getSession = cache(async (): Promise<Session | null> => {
  // Read headers before touching `auth`: during prerendering this is what marks the route
  // dynamic, so the auth instance is never created at build time.
  const requestHeaders = await headers();
  return auth.api.getSession({ headers: requestHeaders });
});

/**
 * For page chrome such as the header: a broken auth setup shouldn't take every page down,
 * so failures are logged and treated as signed out. Pages that need a session use
 * `getSession` and let errors surface.
 */
export async function getSessionOrNull(): Promise<Session | null> {
  try {
    return await getSession();
  } catch (error) {
    unstable_rethrow(error);
    console.error("[auth] could not read the session", error);
    return null;
  }
}

/**
 * Only same-origin paths are allowed as post-sign-in destinations, so a crafted
 * `?next=https://evil.example` (or `/%09/evil.example`) link can't bounce users off-site.
 * The URL is parsed and its origin compared; see `safeRedirectPath` in @nevile/auth.
 */
export function safeNextPath(value: string | string[] | undefined, fallback = "/account"): string {
  return safeRedirectPath(value, fallback);
}
