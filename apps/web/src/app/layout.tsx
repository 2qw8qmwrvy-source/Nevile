import { seasonFor } from "@nevile/core";
import { color } from "@nevile/tokens";
import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import { connection } from "next/server";
import { type ReactNode, ViewTransition } from "react";
import { Providers } from "@/components/providers.tsx";
import { SiteFooter } from "@/components/site/site-footer.tsx";
import { SiteHeader } from "@/components/site/site-header.tsx";
import { VerificationBanner } from "@/components/verification/verification-banner.tsx";
import { hasSessionCookie } from "@/lib/auth.ts";
import { seasonCssVars, tokenCssVars } from "@/lib/theme.ts";
import "./globals.css";

// `adjustFontFallback` (on by default) sizes the system fallback to match each font's
// metrics, so text doesn't jump when the web font arrives.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: "variable",
  axes: ["opsz"],
  variable: "--font-bricolage",
  display: "swap",
});

const body = Figtree({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-figtree",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const description =
  "Find, book and pay local home-service businesses in Nova Scotia: lawn care, snow and ice removal, cleaning and more, with clear prices and real reviews.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Nevile · Local home services in Nova Scotia, booked and paid in one place",
    template: "%s · Nevile",
  },
  description,
  applicationName: "Nevile",
  openGraph: {
    type: "website",
    siteName: "Nevile",
    locale: "en_CA",
    title: "Nevile · Local home services in Nova Scotia, booked and paid in one place",
    description,
    url: "/",
  },
  twitter: { card: "summary" },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: color.ground,
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page carries a fresh CSP nonce (src/proxy.ts), which Next can only apply to
  // pages rendered per request. Speed comes from streaming, prefetching and loading
  // skeletons instead of static pages (SPEC §16).
  await connection();
  // SPEC §13: the site re-themes by the current month in Nova Scotia; no manual switch.
  const season = seasonFor(new Date());
  const sessionCookie = await hasSessionCookie();

  return (
    <html
      lang="en-CA"
      data-season={season}
      // globals.css scrolls smoothly for in-page links; Next skips it during navigations.
      data-scroll-behavior="smooth"
      className={`${display.variable} ${body.variable}`}
      style={{ ...tokenCssVars(), ...seasonCssVars(season) }}
    >
      <body className="flex min-h-dvh flex-col bg-ground font-sans text-ink">
        <SiteHeader />
        {/* At least a screen tall (less the 72px header), so the footer starts below the
            fold while a page streams in and doesn't jump away when the content arrives. */}
        <main id="main" className="min-h-[calc(100dvh-72px)] flex-1">
          <Providers>
            {/* Navigations are React transitions, so pages crossfade briefly (globals.css). */}
            <ViewTransition default="nv-page">{children}</ViewTransition>
          </Providers>
        </main>
        <SiteFooter />
        <VerificationBanner hasSessionCookie={sessionCookie} />
      </body>
    </html>
  );
}
