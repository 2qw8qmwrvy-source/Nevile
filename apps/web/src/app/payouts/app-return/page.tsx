import { MOBILE_APP_ORIGIN } from "@nevile/auth";
import type { Metadata } from "next";
import { buttonClasses } from "@/components/ui/button.tsx";
import { Container } from "@/components/ui/container.tsx";

export const metadata: Metadata = {
  title: "Back to the app",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Where Stripe's payout setup sends a business that started it in the app (SPEC §20). It
 * needs no sign-in: the app re-checks the setup itself when it comes back.
 */
export default async function PayoutAppReturnPage({ searchParams }: Props) {
  const { retry } = await searchParams;
  return (
    <Container className="pt-1 pb-16">
      <section className="mx-auto max-w-md rounded-panel border border-border bg-surface p-6 text-center">
        <h1 className="font-display text-[26px] font-bold">
          {retry ? "That link expired" : "Payout setup: done here"}
        </h1>
        <p className="mt-2 text-[15px] text-muted">
          {retry
            ? "Go back to the Nevile app and tap Continue payout setup to get a fresh link."
            : "Go back to the Nevile app. It checks whether Stripe has everything it needs."}
        </p>
        <a
          href={`${MOBILE_APP_ORIGIN}payout-return`}
          className={buttonClasses({ size: "lg", block: true, className: "mt-6" })}
        >
          Back to the Nevile app
        </a>
      </section>
    </Container>
  );
}
