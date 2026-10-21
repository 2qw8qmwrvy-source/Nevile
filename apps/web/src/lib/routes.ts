import type { Route } from "next";

/**
 * Links into the auth area (src/app/(auth), owned by the auth module). They are cast
 * because typed routes only know pages that exist when types are generated, and these
 * pages are built separately.
 */
export const authRoutes = {
  signIn: "/sign-in" as Route,
  signUp: "/sign-up" as Route,
  signUpBusiness: "/sign-up?intent=business" as Route,
} as const;
