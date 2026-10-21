import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./redirect.ts";

const ORIGIN = "https://nevile.ca";

/** Where a browser would actually go if it navigated to `path` from the sign-in page. */
function resolvedOrigin(path: string): string {
  return new URL(path, `${ORIGIN}/sign-in`).origin;
}

describe("safeRedirectPath", () => {
  it.each([
    ["/account", "/account"],
    ["/account?tab=business#plans", "/account?tab=business#plans"],
    ["/sign-up?intent=business", "/sign-up?intent=business"],
    ["/a/../b", "/b"],
    ["/%09/evil.example", "/%09/evil.example"],
  ])("keeps the same-origin path %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
    expect(resolvedOrigin(expected)).toBe(ORIGIN);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example", // ?next=/%09/evil.example after decoding
    "/\n/evil.example",
    "/\r/evil.example",
    "/\t\\evil.example",
    "\t//evil.example",
    "/.//evil.example",
    "/%2e//evil.example",
    "javascript:alert(1)",
    "account",
    "",
  ])("falls back for %j", (input) => {
    expect(safeRedirectPath(input, "/account")).toBe("/account");
  });

  it("never returns a path that resolves off-site", () => {
    const inputs = ["/\t/evil.example", "/.//evil.example", "/x/..//evil.example", "/./%2F/evil"];
    for (const input of inputs) {
      expect(resolvedOrigin(safeRedirectPath(input, "/account"))).toBe(ORIGIN);
    }
  });

  it("takes the first of repeated query values and defaults to /", () => {
    expect(safeRedirectPath(["/one", "/two"])).toBe("/one");
    expect(safeRedirectPath(undefined)).toBe("/");
    expect(safeRedirectPath(null, "/home")).toBe("/home");
  });
});
