import type { ReactNode } from "react";
import { Container } from "@/components/ui/container.tsx";

/**
 * Sign-in, sign-up and email confirmation: one form card on the current season's tint.
 * The season colours come from the root layout (Nova Scotia month, SPEC §13).
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <div className="rounded-panel bg-season-tint px-4 py-8 sm:rounded-hero sm:px-10 sm:py-14">
        <div className="mx-auto w-full max-w-[460px]">{children}</div>
      </div>
    </Container>
  );
}
