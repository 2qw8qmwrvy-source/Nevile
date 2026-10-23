import { appRouter, createContext } from "@nevile/api";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { crossSiteRefused, isForeignOrigin } from "@/lib/same-origin.ts";

async function handler(req: Request): Promise<Response> {
  if (isForeignOrigin(req)) return crossSiteRefused();
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: ({ req: request, resHeaders }) =>
      createContext({ headers: request.headers, resHeaders }),
    onError({ error, path }) {
      // Expected client errors are part of the API; log only server faults.
      if (error.code === "INTERNAL_SERVER_ERROR") {
        console.error(`[trpc] ${path ?? "<unknown>"} failed`, error.cause ?? error);
      }
    },
  });
}

export { handler as GET, handler as POST };
