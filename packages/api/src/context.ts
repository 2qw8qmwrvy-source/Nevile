import { type Auth, auth as defaultAuth, type EmailSender, type Session } from "@nevile/auth";
import { type Database, db as defaultDb } from "@nevile/db";
import { lazyPaymentProvider, type PaymentProvider } from "@nevile/payments";
import { lazyStorage, type MediaStorage } from "@nevile/storage";
import { type ApiConfig, getApiConfig } from "./config.ts";
import { defaultEmailSender } from "./notify.ts";

export interface Context {
  db: Database;
  /** The caller's Better Auth session, or null when signed out. */
  session: Session | null;
  /** Request headers, for procedures that need the client IP or user agent. */
  headers: Headers;
  /** Feature switches (`NEVILE_NEIGHBOURS_ENABLED`, ...). */
  config: ApiConfig;
  /** Business photos and logos (SPEC §18). */
  storage: MediaStorage;
  /** Card payments, refunds and payouts (SPEC §19). */
  payments: PaymentProvider;
  /** Booking notifications. Sends never block or undo a booking change. */
  email: EmailSender;
  /** The current time; tests move it. */
  now: () => Date;
}

export interface CreateContextOptions {
  headers: Headers;
  /**
   * Response headers of the HTTP request, when there is one. Session refreshes (Better
   * Auth extends a session once a day) are written here as Set-Cookie headers.
   */
  resHeaders?: Headers;
  db?: Database;
  auth?: Pick<Auth, "api">;
  /** A session already read for this request (skips the lookup). */
  session?: Session | null;
  /** Defaults to the environment (`getApiConfig()`). */
  config?: ApiConfig;
  /** Defaults to the storage configured by MEDIA_STORAGE (`@nevile/storage`). */
  storage?: MediaStorage;
  /** Defaults to the provider configured by PAYMENTS_PROVIDER (`@nevile/payments`). */
  payments?: PaymentProvider;
  email?: EmailSender;
  now?: () => Date;
}

/** Resolves the session from the request cookies once per request. */
export async function createContext(options: CreateContextOptions): Promise<Context> {
  const auth = options.auth ?? defaultAuth;
  const { headers, resHeaders } = options;
  let session: Session | null;
  if (options.session !== undefined) {
    session = options.session;
  } else if (resHeaders) {
    const result = await auth.api.getSession({ headers, returnHeaders: true });
    for (const cookie of result.headers.getSetCookie()) resHeaders.append("set-cookie", cookie);
    session = result.response;
  } else {
    session = await auth.api.getSession({ headers });
  }
  return {
    db: options.db ?? defaultDb,
    session,
    headers,
    config: options.config ?? getApiConfig(),
    storage: options.storage ?? lazyStorage,
    payments: options.payments ?? lazyPaymentProvider,
    email: options.email ?? defaultEmailSender,
    now: options.now ?? (() => new Date()),
  };
}
