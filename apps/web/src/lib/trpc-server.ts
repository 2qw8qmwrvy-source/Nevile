import "server-only";
import { createCaller, createContext } from "@nevile/api";
import { headers } from "next/headers";
import { cache } from "react";
import { getSession, hasSessionCookie } from "./auth.ts";

/**
 * tRPC caller for server components, sharing this request's session lookup. Visitors
 * without a session cookie skip the lookup, so public pages (search, pro pages) never
 * depend on the auth service.
 */
export const getServerCaller = cache(async () => {
  const session = (await hasSessionCookie()) ? await getSession() : null;
  const context = await createContext({ headers: await headers(), session });
  return createCaller(context);
});
