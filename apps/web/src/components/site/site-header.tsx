import { Button } from "@/components/ui/button.tsx";
import { Container } from "@/components/ui/container.tsx";
import { Logo } from "@/components/ui/logo.tsx";
import { getSessionOrNull } from "@/lib/auth.ts";
import { authRoutes } from "@/lib/routes.ts";
import { DesktopNav, MobileMenu } from "./header-nav.tsx";

export async function SiteHeader() {
  const signedIn = (await getSessionOrNull()) !== null;
  return (
    <header className="relative z-30 w-full">
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
          {signedIn ? (
            <Button href="/account" variant="secondary">
              Account
            </Button>
          ) : (
            <>
              <Button href={authRoutes.signIn} variant="ghost" className="hidden sm:inline-flex">
                Sign in
              </Button>
              <Button href={authRoutes.signUp}>Sign up</Button>
            </>
          )}
          <MobileMenu signedIn={signedIn} />
        </div>
      </Container>
    </header>
  );
}
