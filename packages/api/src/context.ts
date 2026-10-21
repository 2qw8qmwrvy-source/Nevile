import { type Auth, auth as defaultAuth, type Session } from "@nevile/auth";
import { type Database, db as defaultDb } from "@nevile/db";

export interface Context {
  db: Database;
  /** The caller's Better Auth session, or null when signed out. */
  session: Session | null;
  /** Request headers, for procedures that need the client IP or user agent. */
  headers: Headers;
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
  return { db: options.db ?? defaultDb, session, headers };
}
