import { randomUUID } from "node:crypto";

/** Storage keys: lowercase letters, digits, `/`, `-`, `_` and `.`, no `..` or leading `/`. */
const SAFE_KEY = /^(?!\/)(?!.*\.\.)[a-z0-9][a-z0-9/_.-]{0,250}$/;

export function isSafeKey(key: string): boolean {
  return SAFE_KEY.test(key) && !key.includes("//");
}

export function assertSafeKey(key: string): void {
  if (!isSafeKey(key)) throw new Error("Invalid storage key.");
}

export type MediaKind = "photo" | "logo";

/** `businesses/<id>/photos/<uuid>.webp` or `businesses/<id>/logo/<uuid>.webp`. */
export function businessMediaKey(businessId: string, kind: MediaKind): string {
  const folder = kind === "logo" ? "logo" : "photos";
  const key = `businesses/${businessId.toLowerCase()}/${folder}/${randomUUID()}.webp`;
  assertSafeKey(key);
  return key;
}

/** The business id a key belongs to, or null. */
export function businessIdOfKey(key: string): string | null {
  const match = /^businesses\/([0-9a-f-]{36})\//.exec(key);
  return match?.[1] ?? null;
}

const CONTENT_TYPES: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

export function contentTypeOfKey(key: string): string {
  const extension = key.slice(key.lastIndexOf(".") + 1);
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}
