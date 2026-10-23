"use client";

import type { Route } from "next";
import Link from "next/link";
import { authRoutes } from "@/lib/routes.ts";
import { useAuthState } from "@/lib/use-auth-state.ts";

export const footerLinkClass =
  "inline-flex min-h-11 items-center text-[15px] text-muted no-underline hover:text-primary hover:underline md:min-h-0 md:py-1";

const signedOutLinks: { href: Route; label: string }[] = [
  { href: authRoutes.signIn, label: "Sign in" },
  { href: authRoutes.signUp, label: "Create an account" },
];

const signedInLinks: { href: Route; label: string }[] = [
  { href: "/account", label: "Your account" },
  { href: "/welcome", label: "Your preferences" },
];

/** The footer's account column, from the browser's session (pages don't wait for it). */
export function FooterAccountLinks({ hasSessionCookie }: { hasSessionCookie: boolean }) {
  const { status } = useAuthState(hasSessionCookie);
  const links = status === "signed-in" ? signedInLinks : signedOutLinks;
  return (
    <ul className="grid gap-0.5" aria-busy={status === "unknown" || undefined}>
      {links.map((link) => (
        <li key={link.label}>
          <Link
            href={link.href}
            className={
              status === "unknown" ? `${footerLinkClass} invisible` : footerLinkClass
            }
          >
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
