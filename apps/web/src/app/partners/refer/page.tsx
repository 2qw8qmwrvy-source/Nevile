import { contactEmail } from "@nevile/auth/client";
import { DEFAULT_CATEGORIES, NS_REGIONS } from "@nevile/core";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card.tsx";
import { Container } from "@/components/ui/container.tsx";
import { VerificationRequired } from "@/components/verification/verification-required.tsx";
import { getSession } from "@/lib/auth.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";
import { ReferralForm } from "./referral-form.tsx";

export const metadata: Metadata = {
  title: "Refer a neighbour",
  robots: { index: false, follow: false },
};

function Shell({ children }: { children: ReactNode }) {
  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <div className="rounded-panel bg-season-tint px-4 py-8 sm:rounded-hero sm:px-10 sm:py-12">
        <div className="mx-auto w-full max-w-[680px]">
          <p className="text-sm font-semibold tracking-[0.06em] text-season-ink uppercase">
            Nevile Neighbours · Partners
          </p>
          <h1 className="mt-2.5 font-display text-[32px] leading-[1.08] font-extrabold tracking-[-0.03em] sm:text-[38px]">
            Refer a neighbour
          </h1>
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </Container>
  );
}

/** Referral intake for partner organization staff (SPEC §15). */
export default async function ReferPage() {
  if (!(await getSession())) redirect("/sign-in?next=/partners/refer");
  const caller = await getServerCaller();
  const [{ enabled }, me] = await Promise.all([caller.community.status(), caller.me.get()]);

  if (!enabled) {
    return (
      <Shell>
        <Card>
          <p className="text-[16px] leading-relaxed">
            Nevile Neighbours is launching soon. Referrals aren&apos;t open yet.
          </p>
          <Link
            href="/neighbours"
            className="mt-3 inline-flex min-h-11 items-center font-semibold text-primary"
          >
            About the program
          </Link>
        </Card>
      </Shell>
    );
  }

  if (!me.verified) {
    return (
      <Shell>
        <VerificationRequired action="make referrals" email={contactEmail(me.user.email)} />
      </Shell>
    );
  }

  const partners = await caller.community.myPartners();
  if (partners.length === 0) {
    return (
      <Shell>
        <Card>
          <p className="text-[16px] leading-relaxed">
            Referrals come from staff at our partner organizations. Your account isn&apos;t linked
            to a partner yet. If your organization works with us, ask your coordinator to add you.
          </p>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <ReferralForm
        partners={partners.map(({ id, name }) => ({ id, name }))}
        regions={NS_REGIONS.map(({ id, name }) => ({ id, name }))}
        categories={DEFAULT_CATEGORIES.map(({ slug, name }) => ({ slug, name }))}
      />
    </Shell>
  );
}
