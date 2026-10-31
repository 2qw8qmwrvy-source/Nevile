/**
 * Post-sign-in destinations (`?next=`). Pure and dependency-free, so web and mobile can
 * share it. Only same-origin paths survive: anything a browser or `new URL()` would
 * resolve to another origin falls back.
 */

const BASE = "http://nevile.invalid";
/**
 * Control characters and backslashes. The URL parser silently drops tab, CR and LF, and
 * browsers read "\" as "/", so "/\t/evil.example" or "/\\evil.example" would otherwise
 * become the network-path reference "//evil.example".
 */
function hasUnsafeCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

/** A same-origin path (with its query and hash) for `value`, or `fallback`. */
export function safeRedirectPath(
  value: string | readonly string[] | null | undefined,
  fallback = "/",
): string {
  const next = Array.isArray(value) ? value[0] : value;
  if (typeof next !== "string" || !next.startsWith("/") || hasUnsafeCharacter(next)) {
    return fallback;
  }
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // Dot segments can still normalise to "//host" ("/.//evil.example").
  if (path.startsWith("//")) return fallback;
  return path;
}
