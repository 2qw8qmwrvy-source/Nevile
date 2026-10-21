/** Shared by the server config and the clients; keep this module free of server imports. */

/** Cookies are named `nevile.session_token` etc.; mobile clients must use the same prefix. */
export const AUTH_COOKIE_PREFIX = "nevile";

/** Origin of the Expo app's deep links (`scheme` in apps/mobile/app.json). */
export const MOBILE_APP_ORIGIN = "nevile://";
