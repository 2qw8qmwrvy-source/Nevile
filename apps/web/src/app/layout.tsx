import { color } from "@nevile/tokens";
import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site/site-footer.tsx";
import { SiteHeader } from "@/components/site/site-header.tsx";
import { tokenCssVars } from "@/lib/theme.ts";
import "./globals.css";

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
  "Find, book and pay local home-service businesses in Canada: lawn care, snow and ice removal, cleaning and more, with clear prices and real reviews.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Nevile · Local home services, booked and paid in one place",
    template: "%s · Nevile",
  },
  description,
  applicationName: "Nevile",
  openGraph: {
    type: "website",
    siteName: "Nevile",
    locale: "en_CA",
    title: "Nevile · Local home services, booked and paid in one place",
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-CA" className={`${display.variable} ${body.variable}`} style={tokenCssVars()}>
      <body className="flex min-h-dvh flex-col bg-ground font-sans text-ink">
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
