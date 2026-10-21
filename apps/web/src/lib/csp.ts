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
 */
export function contentSecurityPolicy(
  nonce: string,
  env: string | undefined = process.env.NODE_ENV,
): string {
  const isDev = env === "development";
  const isProd = env === "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    ...(isProd ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** 128 random bits, base64-encoded, as CSP nonces should be. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
