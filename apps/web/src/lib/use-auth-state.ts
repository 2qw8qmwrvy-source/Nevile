"use client";

import { verificationMethodOf } from "@nevile/auth/client";
import { authClient } from "./auth-client.ts";

export type AuthStatus = "signed-in" | "signed-out" | "unknown";

type SessionData = NonNullable<ReturnType<typeof authClient.useSession>["data"]>;
export type SessionUser = SessionData["user"];

/**
 * The browser's view of the session, for page chrome (header, footer, banners). Pages
 * render without waiting for it: the session is fetched once by the browser and shared.
 * `hasSessionCookie` (from the server, no database read) lets visitors without a session
 * cookie see the signed-out chrome immediately; with a cookie the state is "unknown"
 * until the session arrives.
 */
export function useAuthState(hasSessionCookie: boolean): {
  status: AuthStatus;
  user: SessionUser | null;
  verified: boolean;
} {
  const { data, isPending } = authClient.useSession();
  if (data) {
    return { status: "signed-in", user: data.user, verified: verificationMethodOf(data.user) !== null };
  }
  if (isPending && hasSessionCookie) return { status: "unknown", user: null, verified: false };
  return { status: "signed-out", user: null, verified: false };
}
