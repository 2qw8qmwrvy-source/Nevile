import "server-only";
import { createCaller, createContext } from "@nevile/api";
import { headers } from "next/headers";
import { cache } from "react";
import { getSession } from "./auth.ts";

/** tRPC caller for server components, sharing this request's session lookup. */
export const getServerCaller = cache(async () => {
  const context = await createContext({ headers: await headers(), session: await getSession() });
  return createCaller(context);
});
