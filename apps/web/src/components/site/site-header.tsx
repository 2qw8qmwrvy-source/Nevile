import { Container } from "@/components/ui/container.tsx";
import { Logo } from "@/components/ui/logo.tsx";
import { hasSessionCookie } from "@/lib/auth.ts";
import { DesktopNav, HeaderAccount, MobileMenu } from "./header-nav.tsx";

/**
 * Site header. The signed-in state comes from the browser (see `useAuthState`), so pages
 * never wait on a session lookup; the cookie check below reads no database.
 */
export async function SiteHeader() {
  const sessionCookie = await hasSessionCookie();
  return (
    <header className="nv-site-header relative z-30 w-full">
      <a
        href="#main"
        className="sr-only rounded-full bg-primary px-5 py-3 font-semibold text-on-primary focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>
      <Container className="flex min-h-[72px] items-center gap-2 sm:gap-5">
        <Logo />
        <DesktopNav />
        <div className="ml-auto flex items-center gap-1.5">
          <HeaderAccount hasSessionCookie={sessionCookie} />
          <MobileMenu hasSessionCookie={sessionCookie} />
        </div>
      </Container>
    </header>
  );
}
