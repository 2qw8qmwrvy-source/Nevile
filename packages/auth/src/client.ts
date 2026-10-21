import type { BetterAuthClientPlugin } from "better-auth/client";
import { phoneNumberClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export { AUTH_COOKIE_PREFIX, MOBILE_APP_ORIGIN, NAME_MAX_LENGTH } from "./constants.ts";

/**
 * React auth client for web and mobile. `baseURL` is the web origin hosting `/api/auth`;
 * omit it in the browser to use the current origin. Mobile passes `expoClient(...)` from
 * `@better-auth/expo/client` in `extraPlugins`.
 */
export function createNevileAuthClient<const Extra extends BetterAuthClientPlugin[] = []>(
  baseURL?: string,
  extraPlugins?: Extra,
) {
  return createAuthClient({
    ...(baseURL ? { baseURL } : {}),
    plugins: [phoneNumberClient(), ...((extraPlugins ?? []) as Extra)],
  });
}

export type NevileAuthClient = ReturnType<typeof createNevileAuthClient>;
