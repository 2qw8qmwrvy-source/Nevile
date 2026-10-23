/**
 * Content Security Policy for HTML pages, sent by `src/proxy.ts` with a fresh nonce on
 * every request. Next reads the nonce from the request's CSP header and puts it on its
 * own bootstrap and chunk scripts, so no inline script runs without it ('unsafe-inline'
 * is not allowed for scripts). 'strict-dynamic' lets those nonced scripts load the
 * page's other chunks.
 * - Fonts are self-hosted by next/font, so everything else is same-origin.
 * - Styles keep 'unsafe-inline': React sets style attributes (e.g. the token CSS
 *   variables on <html>), and a nonce in style-src would switch 'unsafe-inline' off.
 * - React needs 'unsafe-eval' only in development (error-stack reconstruction).
 * - Maps (SPEC §18) fetch their style, tiles, fonts and icons from OpenFreeMap and draw in
 *   a blob: web worker.
 * - Business photos come from the media bucket's public URL when one is configured.
 */
export function contentSecurityPolicy(
  nonce: string,
  env: string | undefined = process.env.NODE_ENV,
  sentryDsn: string | undefined = process.env.NEXT_PUBLIC_SENTRY_DSN,
  mediaBaseUrl: string | undefined = process.env.MEDIA_PUBLIC_BASE_URL,
): string {
  const isDev = env === "development";
  const isProd = env === "production";
  const sentryOrigin = originOf(sentryDsn);
  const mediaOrigin = originOf(mediaBaseUrl);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data:${mediaOrigin ? ` ${mediaOrigin}` : ""}`,
    "font-src 'self'",
    // Browser error reports go to Sentry only when a DSN is configured (SPEC §17).
    `connect-src 'self' ${MAP_TILES_ORIGIN}${sentryOrigin ? ` ${sentryOrigin}` : ""}${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    ...(isProd ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** Map style, vector tiles, fonts and sprites (OpenFreeMap, free and keyless). */
export const MAP_TILES_ORIGIN = "https://tiles.openfreemap.org";

/** "https://key@o1.ingest.sentry.io/2" → "https://o1.ingest.sentry.io"; null if unset or not https. */
function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** 128 random bits, base64-encoded, as CSP nonces should be. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
