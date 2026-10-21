import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// The monorepo keeps one `.env` at the root (copied from `.env.example`). Next only reads
// `apps/web/.env*`, so load the root file as well. Values that are already set (the shell,
// `apps/web/.env*`) win; the file only fills gaps.
const rootEnvFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

const isProd = process.env.NODE_ENV === "production";

// The page Content Security Policy is per request (nonce): see src/proxy.ts and
// src/lib/csp.ts. API responses are never rendered as pages, so nothing may load there.
const apiCsp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(self), payment=(self), usb=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  // CLAUDE.md is the contributor guide; don't let `next dev` write apps/web/AGENTS.md.
  agentRules: false,
  // Internal packages ship TypeScript source.
  transpilePackages: [
    "@nevile/api",
    "@nevile/auth",
    "@nevile/core",
    "@nevile/db",
    "@nevile/tokens",
  ],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/api/:path*",
        headers: [{ key: "Content-Security-Policy", value: apiCsp }],
      },
    ];
  },
};

export default nextConfig;
