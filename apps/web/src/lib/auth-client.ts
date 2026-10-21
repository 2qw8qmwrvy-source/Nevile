import { createNevileAuthClient } from "@nevile/auth/client";

/** Browser auth client; talks to `/api/auth` on the current origin. */
export const authClient = createNevileAuthClient();

type AuthErrorLike = { status?: number; code?: string; message?: string } | null | undefined;

/** Plain-language message for a Better Auth client error. */
export function authErrorMessage(
  error: AuthErrorLike,
  fallback = "Something went wrong. Please try again.",
): string {
  if (!error) return fallback;
  if (error.status === 429) return "Too many attempts. Please wait a minute and try again.";
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
      return fallback;
  }
}
