/** Shared by the server config and the clients; keep this module free of server imports. */

/** Cookies are named `nevile.session_token` etc.; mobile clients must use the same prefix. */
export const AUTH_COOKIE_PREFIX = "nevile";

/** Origin of the Expo app's deep links (`scheme` in apps/mobile/app.json). */
export const MOBILE_APP_ORIGIN = "nevile://";

/** Longest accepted display name, enforced on sign-up and profile updates. */
export const NAME_MAX_LENGTH = 100;

/** Email verification links stay valid for an hour. */
export const EMAIL_VERIFICATION_EXPIRES_IN_SECONDS = 60 * 60;

/** SMS sign-in codes: 6 digits, valid for 5 minutes. */
export const OTP_LENGTH = 6;
export const OTP_EXPIRES_IN_SECONDS = 5 * 60;
