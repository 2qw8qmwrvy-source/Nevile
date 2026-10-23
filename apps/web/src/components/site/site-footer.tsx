import type { Route } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container.tsx";
import { Logo } from "@/components/ui/logo.tsx";
import { hasSessionCookie } from "@/lib/auth.ts";
import { authRoutes } from "@/lib/routes.ts";
import { FooterAccountLinks, footerLinkClass } from "./footer-account-links.tsx";

type FooterColumn = { title: string; label: string; links: { href: Route; label: string }[] };

const columns: FooterColumn[] = [
  {
    title: "Customers",
    label: "For customers",
    links: [
      { href: "/search", label: "Browse services" },
      { href: "/#how", label: "How it works" },
      { href: "/search?service=snow-ice-removal", label: "Snow & ice removal" },
      { href: "/neighbours", label: "Nevile Neighbours" },
    ],
  },
  {
    title: "Businesses",
    label: "For businesses",
    links: [
      { href: authRoutes.signUpBusiness, label: "List your business" },
      { href: "/for-businesses#pro", label: "Pro plan" },
      { href: "/for-businesses#teams", label: "Teams and crews" },
      { href: "/for-businesses#fees", label: "Payouts and fees" },
    ],
  },
];

const legalLinks: { href: Route; label: string }[] = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/accessibility", label: "Accessibility" },
];

export async function SiteFooter() {
  const sessionCookie = await hasSessionCookie();
  const year = new Date().getFullYear();
  return (
    <footer className="mt-14 border-t border-border bg-surface">
      <Container className="pt-9 pb-6">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]">
          <div className="col-span-2 md:col-span-1">
            <Logo size="sm" />
            <p className="mt-2.5 max-w-[290px] text-sm leading-relaxed text-muted">
              Year-round home services from local, reviewed businesses across Nova Scotia.
            </p>
          </div>
          {columns.map((column) => (
            <nav key={column.title} aria-label={column.label}>
              <h2 className="mb-2 text-[13px] font-semibold tracking-[0.06em] text-ink uppercase">
                {column.title}
              </h2>
              <ul className="grid gap-0.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className={footerLinkClass}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
          <nav aria-label="Account">
            <h2 className="mb-2 text-[13px] font-semibold tracking-[0.06em] text-ink uppercase">
              Account
            </h2>
            <FooterAccountLinks hasSessionCookie={sessionCookie} />
          </nav>
        </div>
        <div className="mt-7 flex flex-col gap-3 border-t border-border pt-4.5 text-sm text-muted md:flex-row md:flex-wrap md:items-center md:justify-between">
          <nav aria-label="Legal">
            <ul className="flex flex-wrap gap-x-5">
              {legalLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex min-h-11 items-center text-muted no-underline hover:text-primary hover:underline md:min-h-0 md:py-1"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <p>
            &copy; {year} Nevile · Prices in CAD. HST is added at checkout where it applies.
          </p>
        </div>
      </Container>
    </footer>
  );
}
