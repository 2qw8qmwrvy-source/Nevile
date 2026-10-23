import type { BetterAuthClientPlugin } from "better-auth/client";
import { inferAdditionalFields, phoneNumberClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export {
  AUTH_COOKIE_PREFIX,
  EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
  MOBILE_APP_ORIGIN,
  NAME_MAX_LENGTH,
  OTP_EXPIRES_IN_SECONDS,
  OTP_LENGTH,
} from "./constants.ts";
export {
  type ContactFields,
  contactEmail,
  hasVerifiedContact,
  isPlaceholderEmail,
  PHONE_PLACEHOLDER_EMAIL_DOMAIN,
  type VerificationMethod,
  verificationMethodOf,
} from "./identity.ts";

/**
 * Types only: lets `signUp.email` take Nevile's sign-up fields (SPEC §2, §17). The server
 * stores them on the profile, not the user, so they are never returned on the user.
 * `phoneNumber.verify` accepts the same two fields for a first-time phone sign-up.
 */
const signUpFields = inferAdditionalFields({
  user: {
    /** Nova Scotia postal code; required by the server for every new account. */
    postalCode: { type: "string", required: false, input: true, returned: false },
    /** The optional, unticked-by-default CASL consent box. */
    marketingConsent: { type: "boolean", required: false, input: true, returned: false },
  },
});

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
    plugins: [phoneNumberClient(), signUpFields, ...((extraPlugins ?? []) as Extra)],
  });
}

export type NevileAuthClient = ReturnType<typeof createNevileAuthClient>;
