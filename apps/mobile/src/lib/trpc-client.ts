/**
 * tRPC client for the app. Requests go to `${API_URL}/api/trpc` with the session cookie
 * that the auth client keeps in the keychain; the native cookie jar is bypassed so only
 * that cookie is ever sent. React bindings live in `trpc.tsx`.
 */
import type { AppRouter } from "@nevile/api";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import { Platform } from "react-native";
import superjson from "superjson";

import { API_URL, getAuthCookie } from "./auth.ts";

export type ApiError = TRPCClientError<AppRouter>;

export function isApiError(error: unknown): error is ApiError {
  return error instanceof TRPCClientError;
}

/** The tRPC error code (e.g. "UNAUTHORIZED", "CONFLICT"), when the server sent one. */
export function apiErrorCode(error: unknown): string | undefined {
  return isApiError(error) ? error.data?.code : undefined;
}

/**
 * The server's machine-readable reason (e.g. "VERIFICATION_REQUIRED", "NEIGHBOURS_DISABLED"),
 * sent as `error.data.reason` alongside the tRPC code.
 */
export function apiErrorReason(error: unknown): string | null {
  return isApiError(error) ? (error.data?.reason ?? null) : null;
}

/** First Zod message per input field, for showing errors next to form fields. */
export function apiFieldErrors(error: unknown): Record<string, string | undefined> {
  if (!isApiError(error)) return {};
  const fieldErrors = error.data?.zodError?.fieldErrors ?? {};
  return Object.fromEntries(
    Object.entries(fieldErrors).map(([field, messages]) => [field, messages?.[0]]),
  );
}

/** A message safe to show: the server's for expected errors, a generic one otherwise. */
export function apiErrorMessage(error: unknown, fallback = "Something went wrong."): string {
  if (!isApiError(error)) return fallback;
  const status = error.data?.httpStatus;
  if (status === undefined) return "We couldn't reach Nevile. Check your connection and try again.";
  return status < 500 ? error.message : fallback;
}

export function makeTRPCClient() {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${API_URL}/api/trpc`,
        transformer: superjson,
        async headers() {
          const cookie = await getAuthCookie();
          return cookie ? { cookie } : {};
        },
        // `include` would let the platform cookie store add its own cookies alongside ours.
        fetch: (url, options) =>
          fetch(url, { ...options, credentials: Platform.OS === "web" ? "include" : "omit" }),
      }),
    ],
  });
}
