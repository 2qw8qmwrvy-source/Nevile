import type { Route } from "next";

/**
 * Links into the auth area (src/app/(auth)). `satisfies Route` lets typed routes check
 * them at build time, so renaming an auth page breaks the build instead of the link.
 */
export const authRoutes = {
  signIn: "/sign-in",
  signUp: "/sign-up",
  signUpBusiness: "/sign-up?intent=business",
} as const satisfies Record<string, Route>;
