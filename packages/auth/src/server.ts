import { randomUUID } from "node:crypto";
import { expo } from "@better-auth/expo";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@nevile/core";
import {
  and,
  authSchema,
  type Database,
  eq,
  ne,
  profiles,
  rateLimit as rateLimitTable,
  sql,
} from "@nevile/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { phoneNumber } from "better-auth/plugins/phone-number";
import {
  AUTH_COOKIE_PREFIX,
  EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
  MOBILE_APP_ORIGIN,
  NAME_MAX_LENGTH,
  OTP_EXPIRES_IN_SECONDS,
  OTP_LENGTH,
} from "./constants.ts";
import { existingAccountEmail, otpSms, verificationEmail } from "./emails.ts";
import {
  isNormalizedCanadianPhone,
  isPlaceholderEmail,
  placeholderEmailForPhone,
} from "./identity.ts";
import type { EmailMessage, EmailSender, SmsSender } from "./senders.ts";
import { isUserSuspended } from "./suspension.ts";

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;

export const SESSION_EXPIRES_IN_SECONDS = 30 * DAY;
export const SESSION_UPDATE_AGE_SECONDS = DAY;
export const OTP_ALLOWED_ATTEMPTS = 3;

/** A fixed-window quota: at most `max` events per `window` seconds. */
export type Quota = { readonly window: number; readonly max: number };

/** Per phone number, on top of the per-IP limit: at most 3 codes per 10 minutes. */
export const OTP_SENDS_PER_NUMBER = { window: 10 * MINUTE, max: 3 } as const;
/**
 * All SMS codes together, whatever the IP or number: a ceiling on what an SMS-pumping
 * attack can cost. Hitting it logs an alert. Override with `createAuth({ smsBudget })`.
 */
export const DEFAULT_SMS_BUDGET: Quota = { window: 10 * MINUTE, max: 300 };
/**
 * Per account email, whatever the IP: password sign-in attempts. Stops password guessing
 * spread across many IPs; a locked-out owner waits at most 10 minutes.
 */
export const SIGN_IN_ATTEMPTS_PER_EMAIL = { window: 10 * MINUTE, max: 10 } as const;
/**
 * Per recipient address, whatever the IP: verification and "you already have an account"
 * emails. Further messages in the window are dropped silently (the response does not
 * change, so this reveals nothing about the account).
 */
export const AUTH_EMAILS_PER_RECIPIENT = { window: 10 * MINUTE, max: 3 } as const;

/** Default client IP source: the X-Forwarded-For chain, read with `trustedProxies`. */
export const DEFAULT_CLIENT_IP_HEADER = "x-forwarded-for";

/**
 * Per IP and path, in seconds. Stricter than Better Auth's defaults for the endpoints
 * attackers target: credential stuffing, sign-up spam, OTP guessing and SMS/email pumping.
 * Keep every window here and in the quotas above at most 10 minutes: Better Auth prunes
 * rate-limit rows older than the longest window it knows about.
 */
export const AUTH_RATE_LIMIT_RULES = {
  "/sign-in/*": { window: MINUTE, max: 5 },
  "/sign-up/*": { window: 5 * MINUTE, max: 5 },
  "/phone-number/*": { window: 10 * MINUTE, max: 5 },
  "/send-verification-email": { window: 5 * MINUTE, max: 3 },
} as const;

/** Only these fields may be sent to /sign-up/email; anything else (e.g. `phoneNumber`) is refused. */
const SIGN_UP_EMAIL_FIELDS = new Set(["name", "email", "password", "callbackURL", "rememberMe"]);

export interface CreateAuthOptions {
  db: Database;
  /** At least 32 random bytes in production (`openssl rand -base64 32`). */
  secret: string;
  /** Public origin of the web app that serves `/api/auth`, e.g. `https://nevile.ca`. */
  baseURL: string;
  emailSender: EmailSender;
  smsSender: SmsSender;
  /** Extra trusted origins. The web origin and the mobile app scheme are always trusted. */
  trustedOrigins?: string[];
  /** Web page that receives `?token=` from verification emails and confirms it. */
  emailVerificationPath?: string;
  signInPath?: string;
  /**
   * The one header the client IP for rate limiting is read from (SPEC §12); there is no
   * fallback to other headers, because a client can set any header the edge does not
   * overwrite. Either:
   * - "x-forwarded-for" (default), with `trustedProxies` listing every proxy in front of
   *   the app: the rightmost hop that is not a trusted proxy is the client; or
   * - a single-value header the deployment's edge always overwrites, such as
   *   "cf-connecting-ip", "x-vercel-forwarded-for" or "fly-client-ip".
   * In production, "x-forwarded-for" without `trustedProxies` refuses to start.
   */
  clientIpHeader?: string;
  /** Reverse-proxy IPs/CIDRs to skip when reading a multi-hop x-forwarded-for. */
  trustedProxies?: string[];
  /** Ceiling on SMS codes sent across all numbers. Default: `DEFAULT_SMS_BUDGET`. */
  smsBudget?: Quota;
  /** Secure cookies and production hardening. Defaults to NODE_ENV === "production". */
  production?: boolean;
}

type JsonBody = Record<string, unknown> | undefined;

function bodyOf(value: unknown): JsonBody {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Atomically counts one event against `key` in a fixed window, using the same
 * `rate_limit` table as Better Auth (keys are namespaced so they never collide).
 */
async function consumeQuota(
  db: Database,
  key: string,
  quota: Quota,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const now = Date.now();
  const windowMs = quota.window * 1000;
  const windowStart = now - windowMs;
  const [row] = await db
    .insert(rateLimitTable)
    .values({ id: randomUUID(), key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimitTable.key,
      set: {
        count: sql`CASE WHEN ${rateLimitTable.lastRequest} <= ${windowStart} THEN 1 ELSE ${rateLimitTable.count} + 1 END`,
        lastRequest: sql`CASE WHEN ${rateLimitTable.lastRequest} <= ${windowStart} THEN ${now} ELSE ${rateLimitTable.lastRequest} END`,
      },
    })
    .returning({ count: rateLimitTable.count, lastRequest: rateLimitTable.lastRequest });
  if (!row || row.count <= quota.max) return { allowed: true, retryAfter: 0 };
  return { allowed: false, retryAfter: Math.ceil((row.lastRequest + windowMs - now) / 1000) };
}

function tooManyRequests(code: string, message: string, retryAfter: number): APIError {
  return new APIError(
    "TOO_MANY_REQUESTS",
    { code, message },
    {
      "X-Retry-After": String(retryAfter),
    },
  );
}

/**
 * Resolves the client-IP settings, refusing in production a source a client can forge:
 * a bare X-Forwarded-For is whatever the client sent when no trusted proxy rewrites it.
 */
function clientIpSettings(options: CreateAuthOptions, production: boolean) {
  const header = (options.clientIpHeader ?? DEFAULT_CLIENT_IP_HEADER).trim().toLowerCase();
  const trustedProxies = (options.trustedProxies ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!header) throw new Error("clientIpHeader must name a header.");
  if (production && header === DEFAULT_CLIENT_IP_HEADER && trustedProxies.length === 0) {
    throw new Error(
      "Auth rate limiting needs a trusted client IP in production: set BETTER_AUTH_TRUSTED_PROXIES (the proxies in front of the app) or BETTER_AUTH_CLIENT_IP_HEADER (a header your edge always overwrites, e.g. cf-connecting-ip).",
    );
  }
  return {
    ipAddressHeaders: [header],
    ...(trustedProxies.length > 0 ? { trustedProxies } : {}),
  };
}

/** Builds the Better Auth server instance for Nevile (SPEC §1, §12 security baseline). */
export function createAuth(options: CreateAuthOptions) {
  const { db, smsSender } = options;
  const production = options.production ?? process.env.NODE_ENV === "production";
  const ipAddress = clientIpSettings(options, production);
  const smsBudget = options.smsBudget ?? DEFAULT_SMS_BUDGET;
  const appOrigin = new URL(options.baseURL).origin;
  const signInUrl = new URL(options.signInPath ?? "/sign-in", appOrigin).toString();
  const verificationPath = options.emailVerificationPath ?? "/verify-email";

  /** Sends an auth email unless the recipient's per-address cap is used up. */
  const emailSender: EmailSender = {
    async send(message: EmailMessage) {
      const recipient = message.to.trim().toLowerCase();
      const quota = await consumeQuota(db, `email-to|${recipient}`, AUTH_EMAILS_PER_RECIPIENT);
      if (!quota.allowed) {
        // No address in the log line: it is personal data.
        console.warn("[auth] per-recipient email cap reached; message not sent");
        return;
      }
      await options.emailSender.send(message);
    },
  };

  function verificationLink(token: string): string {
    const url = new URL(verificationPath, appOrigin);
    url.searchParams.set("token", token);
    return url.toString();
  }

  return betterAuth({
    appName: "Nevile",
    baseURL: options.baseURL,
    basePath: "/api/auth",
    secret: options.secret,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
      usePlural: false,
      // Sign-up writes the user and its credential account together or not at all.
      transaction: true,
    }),
    trustedOrigins: [...new Set([appOrigin, MOBILE_APP_ORIGIN, ...(options.trustedOrigins ?? [])])],

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      // No session until the address is verified; this also makes sign-up answer the
      // same way for new and already-registered emails (no account enumeration).
      autoSignIn: false,
      async onExistingUserSignUp({ user }) {
        await emailSender.send(
          existingAccountEmail({ to: user.email, name: user.name, signInUrl }),
        );
      },
      // The synthetic "duplicate email" response must match a real new user field for
      // field, including the phone-number plugin's columns.
      customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
        ...coreFields,
        phoneNumber: null,
        phoneNumberVerified: false,
        ...additionalFields,
        id,
      }),
    },

    emailVerification: {
      sendOnSignUp: true,
      // Only reached after a correct password, so it reveals nothing to a guesser.
      sendOnSignIn: true,
      // The user signs in with their password after verifying. A verification link that
      // also signed people in would hand a session to whoever registered the address.
      autoSignInAfterVerification: false,
      expiresIn: EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
      async sendVerificationEmail({ user, token }) {
        // Phone accounts' placeholder addresses are undeliverable by design.
        if (isPlaceholderEmail(user.email)) return;
        await emailSender.send(
          verificationEmail({
            to: user.email,
            name: user.name,
            url: verificationLink(token),
            expiresInMinutes: EMAIL_VERIFICATION_EXPIRES_IN_SECONDS / MINUTE,
          }),
        );
      },
    },

    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },

    rateLimit: {
      enabled: true,
      storage: "database",
      window: MINUTE,
      max: 100,
      customRules: { ...AUTH_RATE_LIMIT_RULES },
    },

    advanced: {
      // Better Auth turns these off under NODE_ENV=test; keep them on everywhere.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      useSecureCookies: production,
      cookiePrefix: AUTH_COOKIE_PREFIX,
      ipAddress,
    },

    // SPEC §1 sign-in is email + password or phone + one-time code; phone + password and
    // the SMS password-reset flow are not offered. There is no social / OAuth sign-in, so
    // the Expo plugin's OAuth proxy (an open redirect on this origin) is switched off too;
    // the rest of the plugin (the mobile app's origin for CSRF checks) keeps working.
    disabledPaths: [
      "/sign-in/phone-number",
      "/phone-number/request-password-reset",
      "/phone-number/reset-password",
      "/expo-authorization-proxy",
    ],

    telemetry: { enabled: false },

    plugins: [
      phoneNumber({
        otpLength: OTP_LENGTH,
        expiresIn: OTP_EXPIRES_IN_SECONDS,
        allowedAttempts: OTP_ALLOWED_ATTEMPTS,
        phoneNumberValidator: isNormalizedCanadianPhone,
        async sendOTP({ phoneNumber: to, code }) {
          await smsSender.send({ to, body: otpSms(code, OTP_EXPIRES_IN_SECONDS / MINUTE) });
        },
        // Verifying a code for an unknown number creates the account (phone sign-up).
        signUpOnVerification: {
          getTempEmail: placeholderEmailForPhone,
          // Never the phone number: names are shown to other users, numbers are not (SPEC §7).
          getTempName: () => "",
        },
      }),
      expo(),
    ],

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email") {
          const body = bodyOf(ctx.body);
          const unknownField = Object.keys(body ?? {}).find(
            (key) => !SIGN_UP_EMAIL_FIELDS.has(key),
          );
          if (unknownField) {
            throw new APIError("BAD_REQUEST", {
              code: "FIELD_NOT_ALLOWED",
              message: `${unknownField} cannot be set at sign-up`,
            });
          }
          const name = body?.name;
          if (typeof name !== "string" || !name.trim() || name.length > NAME_MAX_LENGTH) {
            throw new APIError("BAD_REQUEST", {
              code: "INVALID_NAME",
              message: `Enter your name (up to ${NAME_MAX_LENGTH} characters)`,
            });
          }
          if (typeof body?.email === "string" && isPlaceholderEmail(body.email)) {
            throw new APIError("BAD_REQUEST", {
              code: "INVALID_EMAIL",
              message: "Enter your own email address",
            });
          }
        }

        if (ctx.path === "/sign-in/email") {
          const email = bodyOf(ctx.body)?.email;
          if (typeof email === "string" && email.trim()) {
            const quota = await consumeQuota(
              db,
              `sign-in-email|${email.trim().toLowerCase()}`,
              SIGN_IN_ATTEMPTS_PER_EMAIL,
            );
            if (!quota.allowed) {
              throw tooManyRequests(
                "TOO_MANY_ATTEMPTS",
                "Too many sign-in attempts for this account. Try again later.",
                quota.retryAfter,
              );
            }
          }
        }

        if (ctx.path === "/update-user") {
          const name = bodyOf(ctx.body)?.name;
          if (name !== undefined && (typeof name !== "string" || name.length > NAME_MAX_LENGTH)) {
            throw new APIError("BAD_REQUEST", {
              code: "INVALID_NAME",
              message: `Names can be up to ${NAME_MAX_LENGTH} characters`,
            });
          }
        }

        if (ctx.path === "/phone-number/send-otp") {
          const phone = bodyOf(ctx.body)?.phoneNumber;
          // Malformed numbers are rejected by the endpoint's own validator.
          if (typeof phone === "string" && isNormalizedCanadianPhone(phone)) {
            const quota = await consumeQuota(db, `otp-number|${phone}`, OTP_SENDS_PER_NUMBER);
            if (!quota.allowed) {
              throw tooManyRequests(
                "TOO_MANY_CODES",
                "Too many codes were sent to this number. Try again later.",
                quota.retryAfter,
              );
            }
            const budget = await consumeQuota(db, "otp-global", smsBudget);
            if (!budget.allowed) {
              // Alert: either a traffic spike or SMS pumping. Raise the budget deliberately.
              console.error("[auth] ALERT: global SMS budget exhausted; refusing new codes");
              throw tooManyRequests(
                "SMS_BUDGET_EXCEEDED",
                "We can't send codes right now. Try again later or sign in with email.",
                budget.retryAfter,
              );
            }
          }
        }
      }),
    },

    databaseHooks: {
      session: {
        create: {
          // Suspended users (SPEC §11) cannot start a session by any sign-in method;
          // `suspendUser` revokes the sessions they already had.
          async before(newSession) {
            if (await isUserSuspended(db, newSession.userId)) {
              throw new APIError("FORBIDDEN", {
                code: "ACCOUNT_SUSPENDED",
                message: "This account is suspended. Contact Nevile support.",
              });
            }
          },
        },
      },
      user: {
        create: {
          // Runs after the sign-up transaction commits. A failure here must not fail the
          // sign-up; the API creates a missing profile on demand.
          async after(user) {
            try {
              await db
                .insert(profiles)
                .values({ userId: user.id, displayName: user.name })
                .onConflictDoNothing({ target: profiles.userId });
            } catch (error) {
              console.error("[auth] could not create profile for new user", user.id, error);
            }
          },
        },
        update: {
          async after(user) {
            if (typeof user.name !== "string") return;
            try {
              await db
                .update(profiles)
                .set({ displayName: user.name })
                .where(and(eq(profiles.userId, user.id), ne(profiles.displayName, user.name)));
            } catch (error) {
              console.error("[auth] could not sync profile name", user.id, error);
            }
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
/** `{ session, user }` as returned by `auth.api.getSession`. */
export type Session = Auth["$Infer"]["Session"];
export type User = Session["user"];
