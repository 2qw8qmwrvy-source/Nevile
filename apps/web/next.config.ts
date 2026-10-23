import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// The monorepo keeps one `.env` at the root (copied from `.env.example`). Next only reads
// `apps/web/.env*`, so load the root file as well. Values that are already set (the shell,
// `apps/web/.env*`) win; the file only fills gaps.
const rootEnvFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

const isProd = process.env.NODE_ENV === "production";

// MapLibre runs its renderer in a web worker it loads by URL, which bundlers can't follow.
// Copy the (self-contained) worker into public/ under its version, where the map loads it
// (src/components/map/load-maplibre.ts). The copy is ignored by git.
const require = createRequire(import.meta.url);
const maplibreDir = dirname(require.resolve("maplibre-gl/package.json"));
const maplibreVersion: string = JSON.parse(
  readFileSync(join(maplibreDir, "package.json"), "utf8"),
).version;
const workerTarget = fileURLToPath(
  new URL(`./public/maplibre/worker-${maplibreVersion}.mjs`, import.meta.url),
);
if (!existsSync(workerTarget)) {
  mkdirSync(dirname(workerTarget), { recursive: true });
  copyFileSync(join(maplibreDir, "dist/maplibre-gl-worker.mjs"), workerTarget);
}

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
  env: { NEXT_PUBLIC_MAPLIBRE_VERSION: maplibreVersion },
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
    "@nevile/payments",
    "@nevile/storage",
    "@nevile/tokens",
  ],
  // Native image library: loaded from node_modules at run time, never bundled.
  serverExternalPackages: ["sharp"],
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
