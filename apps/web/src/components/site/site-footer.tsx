import type { Route } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container.tsx";
import { Logo } from "@/components/ui/logo.tsx";
import { authRoutes } from "@/lib/routes.ts";

type FooterColumn = { title: string; label: string; links: { href: Route; label: string }[] };

const columns: FooterColumn[] = [
  {
    title: "Customers",
    label: "For customers",
    links: [
      { href: "/search", label: "Browse services" },
      { href: "/#how", label: "How it works" },
      { href: "/search?service=snow-ice-removal", label: "Snow & ice removal" },
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
  {
    title: "Account",
    label: "Account",
    links: [
      { href: authRoutes.signIn, label: "Sign in" },
      { href: authRoutes.signUp, label: "Create an account" },
    ],
  },
];

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-14 border-t border-border bg-surface">
      <Container className="pt-9 pb-6">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]">
          <div className="col-span-2 md:col-span-1">
            <Logo size="sm" />
            <p className="mt-2.5 max-w-[290px] text-sm leading-relaxed text-muted">
              Year-round home services from local, reviewed businesses across Canada.
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
                    <Link
                      href={link.href}
                      className="inline-flex min-h-11 items-center text-[15px] text-muted no-underline hover:text-primary hover:underline md:min-h-0 md:py-1"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-7 flex flex-wrap justify-between gap-x-6 gap-y-2 border-t border-border pt-4.5 text-sm text-muted">
          <span>&copy; {year} Nevile</span>
          <span>Prices in CAD. Sales tax for your province is added at checkout.</span>
        </div>
      </Container>
    </footer>
  );
}
