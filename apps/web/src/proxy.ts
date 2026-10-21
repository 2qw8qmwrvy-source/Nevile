import { type NextRequest, NextResponse } from "next/server";
import { contentSecurityPolicy, createNonce } from "@/lib/csp.ts";

/**
 * Per-request CSP nonce (see `src/lib/csp.ts`). Every page already renders dynamically
 * (the header reads the session), so the nonce costs no static rendering. The CSP goes on
 * the request too: that is where Next reads the nonce from while rendering.
 */
export function proxy(request: NextRequest) {
  const policy = contentSecurityPolicy(createNonce());
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not API routes, build assets or the icon.
      source: "/((?!api/|_next/static|_next/image|icon.svg|favicon.ico).*)",
      // Router prefetches fetch RSC payloads, not documents; they need no policy.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
