import { getDb } from "@nevile/db";
import { createConsoleEmailSender, createConsoleSmsSender } from "./senders.ts";
import { type Auth, createAuth } from "./server.ts";

export {
  AUTH_COOKIE_PREFIX,
  EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
  MOBILE_APP_ORIGIN,
  NAME_MAX_LENGTH,
  OTP_EXPIRES_IN_SECONDS,
  OTP_LENGTH,
} from "./constants.ts";
export {
  contactEmail,
  isNormalizedCanadianPhone,
  isPlaceholderEmail,
  PHONE_PLACEHOLDER_EMAIL_DOMAIN,
  placeholderEmailForPhone,
} from "./identity.ts";
export { safeRedirectPath } from "./redirect.ts";
export {
  createConsoleEmailSender,
  createConsoleSmsSender,
  type EmailMessage,
  type EmailSender,
  type SmsMessage,
  type SmsSender,
} from "./senders.ts";
export {
  AUTH_EMAILS_PER_RECIPIENT,
  AUTH_RATE_LIMIT_RULES,
  type Auth,
  type CreateAuthOptions,
  createAuth,
  DEFAULT_CLIENT_IP_HEADER,
  DEFAULT_SMS_BUDGET,
  OTP_ALLOWED_ATTEMPTS,
  OTP_SENDS_PER_NUMBER,
  type Quota,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  type Session,
  SIGN_IN_ATTEMPTS_PER_EMAIL,
  type User,
} from "./server.ts";
export { isUserSuspended, suspendUser, unsuspendUser } from "./suspension.ts";

/** Used only outside production when BETTER_AUTH_SECRET is unset. Never deploy it. */
const DEV_ONLY_SECRET = "nevile-local-development-secret-do-not-use-in-production";
const DEV_BASE_URL = "http://localhost:3000";

function listFromEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Builds the default instance from the environment:
 * - BETTER_AUTH_SECRET (required in production)
 * - BETTER_AUTH_URL (public web origin; required in production, else http://localhost:3000)
 * - BETTER_AUTH_TRUSTED_ORIGINS, BETTER_AUTH_TRUSTED_PROXIES (optional, comma-separated)
 * - BETTER_AUTH_CLIENT_IP_HEADER (optional; default x-forwarded-for, see `clientIpHeader`)
 * - DATABASE_URL (via @nevile/db)
 *
 * Outside production, emails and SMS codes are printed to the console. Production has no
 * provider wired yet, so it refuses to start rather than silently drop verification
 * messages; build a production instance with `createAuth` and real senders.
 */
function createAuthFromEnv(): Auth {
  const production = process.env.NODE_ENV === "production";
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;
  if (production) {
    if (!secret) throw new Error("BETTER_AUTH_SECRET must be set in production.");
    if (!baseURL) throw new Error("BETTER_AUTH_URL must be set in production.");
    throw new Error(
      "@nevile/auth has no production email/SMS sender configured. Create the instance with createAuth({ emailSender, smsSender, ... }).",
    );
  }
  if (!secret) {
    console.warn("[auth] BETTER_AUTH_SECRET is not set; using an insecure development secret.");
  }
  return createAuth({
    db: getDb(),
    secret: secret ?? DEV_ONLY_SECRET,
    baseURL: baseURL ?? DEV_BASE_URL,
    emailSender: createConsoleEmailSender(),
    smsSender: createConsoleSmsSender(),
    trustedOrigins: listFromEnv(process.env.BETTER_AUTH_TRUSTED_ORIGINS),
    trustedProxies: listFromEnv(process.env.BETTER_AUTH_TRUSTED_PROXIES),
    clientIpHeader: process.env.BETTER_AUTH_CLIENT_IP_HEADER?.trim() || undefined,
    production,
  });
}

// Cached on globalThis so dev servers with hot reload keep one instance.
const DEFAULT_AUTH_KEY = Symbol.for("@nevile/auth/default");
type GlobalWithAuth = typeof globalThis & { [DEFAULT_AUTH_KEY]?: Auth };

/** The shared instance configured from the environment, created on first use. */
export function getAuth(): Auth {
  const store = globalThis as GlobalWithAuth;
  const existing = store[DEFAULT_AUTH_KEY];
  if (existing) return existing;
  const created = createAuthFromEnv();
  store[DEFAULT_AUTH_KEY] = created;
  return created;
}

/**
 * Lazy handle to `getAuth()`: importing it reads no environment and opens no connection,
 * so build steps can import modules that reference it.
 */
export const auth: Auth = new Proxy({} as Auth, {
  get(_target, prop) {
    const real = getAuth();
    const value: unknown = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
  has(_target, prop) {
    return Reflect.has(getAuth(), prop);
  },
});
