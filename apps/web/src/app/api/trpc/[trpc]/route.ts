import { appRouter, createContext } from "@nevile/api";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Defence in depth on top of SameSite=Lax session cookies: browsers always send Origin on
 * cross-site POSTs, so a mutation from another site is refused before it runs. Requests
 * without Origin (the mobile app, server-to-server) are unaffected.
 */
function isForeignOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (req.method !== "POST" || !origin) return false;
  const allowed = [
    new URL(req.url).origin,
    originOf(process.env.BETTER_AUTH_URL),
    originOf(process.env.NEXT_PUBLIC_SITE_URL),
  ];
  return !allowed.includes(origin);
}

async function handler(req: Request): Promise<Response> {
  if (isForeignOrigin(req)) {
    return Response.json({ error: { message: "Cross-site request refused." } }, { status: 403 });
  }
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
