import { DEFAULT_CATEGORIES } from "@nevile/core";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui/container.tsx";
import { getSession } from "@/lib/auth.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";
import { WelcomeFlow } from "./welcome-flow.tsx";

export const metadata: Metadata = {
  title: "Welcome",
  robots: { index: false, follow: false },
};

type WelcomePageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Optional three-step welcome after sign-up (SPEC §16). Everyone can skip it. */
export default async function WelcomePage({ searchParams }: WelcomePageProps) {
  if (!(await getSession())) redirect("/sign-in?next=/welcome");
  const [{ intent }, caller] = await Promise.all([searchParams, getServerCaller()]);
  const me = await caller.me.get();
  const onboarding = me.onboarding;
  const firstName = me.user.name.trim().split(/\s+/)[0] ?? "";

  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <div className="rounded-panel bg-season-tint px-4 py-8 sm:rounded-hero sm:px-10 sm:py-12">
        <div className="mx-auto w-full max-w-[640px]">
          <WelcomeFlow
            firstName={firstName}
            categories={DEFAULT_CATEGORIES.map(({ slug, name }) => ({ slug, name }))}
            initial={{
              intent: onboarding.intent ?? (intent === "business" ? "business" : null),
              postalCode: onboarding.postalCode ?? "",
              interests: onboarding.interests,
            }}
          />
        </div>
      </div>
    </Container>
  );
}
