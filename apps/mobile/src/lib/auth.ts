/**
 * Better Auth client for the Expo app. Sessions are cookie-based like the web: the Expo
 * plugin stores the `nevile.*` cookies in the device keychain (expo-secure-store) and
 * attaches them to every auth request; `getAuthCookie` exposes them for the tRPC client.
 */
import { expoClient } from "@better-auth/expo/client";
import {
  AUTH_COOKIE_PREFIX,
  createNevileAuthClient,
  EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
  MOBILE_APP_ORIGIN,
  OTP_EXPIRES_IN_SECONDS,
} from "@nevile/auth/client";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Shared with the server through @nevile/auth/client (no server code in that entry point).
export { AUTH_COOKIE_PREFIX, contactEmail, NAME_MAX_LENGTH, OTP_LENGTH } from "@nevile/auth/client";

/** `scheme` in app.json; the server trusts `nevile://` (MOBILE_APP_ORIGIN) as an origin. */
export const APP_SCHEME = MOBILE_APP_ORIGIN.replace("://", "");
/** Lifetime of SMS sign-in codes, for UI copy. */
export const OTP_EXPIRES_IN_MINUTES = OTP_EXPIRES_IN_SECONDS / 60;
/** Lifetime of the verification link in sign-up emails, for UI copy. */
export const EMAIL_LINK_EXPIRES_IN_HOURS = EMAIL_VERIFICATION_EXPIRES_IN_SECONDS / 3600;

const DEFAULT_API_URL = "http://localhost:3000";

/** Origin (plus optional path) of the web app serving `/api/auth` and `/api/trpc`. */
function resolveApiUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) {
    if (!__DEV__) {
      console.error("[auth] EXPO_PUBLIC_API_URL is not set; falling back to", DEFAULT_API_URL);
    }
    return DEFAULT_API_URL;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("not http(s)");
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    console.error("[auth] EXPO_PUBLIC_API_URL is not a valid http(s) URL:", value);
    return DEFAULT_API_URL;
  }
}

export const API_URL = resolveApiUrl(process.env.EXPO_PUBLIC_API_URL);

export const authClient = createNevileAuthClient(`${API_URL}/api/auth`, [
  expoClient({
    scheme: APP_SCHEME,
    storagePrefix: AUTH_COOKIE_PREFIX,
    // Required: without it the plugin only stores `better-auth.*` cookies.
    cookiePrefix: AUTH_COOKIE_PREFIX,
    storage: SecureStore,
  }),
]);

export type AuthSession = typeof authClient.$Infer.Session;

/** Reactive session (`{ data, isPending, error, refetch }`), restored from the keychain on launch. */
export const useSession = authClient.useSession;

/**
 * `Cookie` header value for API requests, or "" when signed out. On web the browser sends
 * cookies itself, and SecureStore is unavailable there.
 */
export async function getAuthCookie(): Promise<string> {
  if (Platform.OS === "web") return "";
  try {
    return await authClient.getCookie();
  } catch (error) {
    console.warn("[auth] could not read the stored session", error);
    return "";
  }
}

export type AuthError = { status?: number; code?: string; message?: string };

/**
 * Runs a Better Auth client call and folds thrown network failures into its `{ error }`
 * result, so screens handle one shape.
 */
export async function callAuth<T extends { error: AuthError | null }>(
  request: () => Promise<T>,
): Promise<{ error: AuthError | null }> {
  try {
    const { error } = await request();
    return { error };
  } catch {
    return { error: { status: 0, code: "NETWORK_ERROR" } };
  }
}

/** Plain-language message for a Better Auth client error (mirrors the web copy). */
export function authErrorMessage(
  error: AuthError | null | undefined,
  fallback = "Something went wrong. Please try again.",
): string {
  if (!error) return fallback;
  if (error.status === 0 || error.code === "NETWORK_ERROR") {
    return "We couldn't reach Nevile. Check your connection and try again.";
  }
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "That email and password don't match. Check them and try again.";
    case "EMAIL_NOT_VERIFIED":
      return "Confirm your email first. We've sent you a new link.";
    case "PASSWORD_TOO_SHORT":
      return "Use at least 10 characters for your password.";
    case "PASSWORD_TOO_LONG":
      return "Use at most 128 characters for your password.";
    case "INVALID_EMAIL":
      return "Enter a valid email address.";
    case "INVALID_NAME":
      return "Enter your name.";
    case "INVALID_PHONE_NUMBER":
      return "Enter a valid Canadian mobile number.";
    case "INVALID_OTP":
      return "That code isn't right. Check the text message and try again.";
    case "OTP_EXPIRED":
    case "OTP_NOT_FOUND":
      return "That code has expired. Send yourself a new one.";
    case "TOO_MANY_ATTEMPTS":
      return "Too many wrong codes. Send yourself a new one.";
    case "TOO_MANY_CODES":
      return "We've sent several codes to this number. Wait a few minutes before asking for another.";
    default:
      if (error.status === 429) return "Too many attempts. Please wait a minute and try again.";
      return fallback;
  }
}

/** "+14165551234" → "(416) 555-1234" */
export function formatPhone(e164: string): string {
  const digits = e164.replace(/^\+1/, "");
  if (!/^\d{10}$/.test(digits)) return e164;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
