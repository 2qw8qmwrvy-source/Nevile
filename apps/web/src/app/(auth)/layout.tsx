import { seasonFor } from "@nevile/core";
import type { ReactNode } from "react";
import { Container } from "@/components/ui/container.tsx";
import { seasonCssVars } from "@/lib/theme.ts";

const AUTH_TIME_ZONE = "America/Toronto";

/** Sign-in, sign-up and email confirmation: one form card on the current season's tint. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const season = seasonFor(new Date(), AUTH_TIME_ZONE);
  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <div
        style={seasonCssVars(season)}
        className="rounded-panel bg-season-tint px-4 py-8 sm:rounded-hero sm:px-10 sm:py-14"
      >
        <div className="mx-auto w-full max-w-[460px]">{children}</div>
      </div>
    </Container>
  );
}
