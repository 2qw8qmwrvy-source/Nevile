import { contactEmail } from "@nevile/auth/client";
import { DEFAULT_CATEGORIES, PROVINCES } from "@nevile/core";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Container } from "@/components/ui/container.tsx";
import { VerificationRequired } from "@/components/verification/verification-required.tsx";
import { getSession } from "@/lib/auth.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";
import { BusinessModeForm } from "./business-mode-form.tsx";
import { EmailUpdatesToggle } from "./email-updates-toggle.tsx";
import { SignOutButton } from "./sign-out-button.tsx";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

const ROLE_LABELS = { owner: "Owner", manager: "Manager", crew: "Crew" } as const;

/** "+19025551234" → "(902) 555-1234" */
function formatPhone(e164: string): string {
  const digits = e164.replace(/^\+1/, "");
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-border py-3.5 first:border-t-0 first:pt-0 last:pb-0 sm:grid-cols-[140px_1fr] sm:gap-4">
      <dt className="text-sm font-semibold text-muted">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 text-[16px] break-words">
        {children}
      </dd>
    </div>
  );
}

type AccountPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AccountPage({ searchParams }: AccountPageProps) {
  if (!(await getSession())) redirect("/sign-in?next=/account");
  const [{ intent }, caller] = await Promise.all([searchParams, getServerCaller()]);
  const [{ user, businesses, verified, onboarding, marketingConsent }, card] = await Promise.all([
    caller.me.get(),
    caller.cards.get(),
  ]);
  const greetingName = user.name.trim();
  const email = contactEmail(user.email);
  const interestNames = DEFAULT_CATEGORIES.filter((category) =>
    onboarding.interests.includes(category.slug),
  ).map((category) => category.name);

  return (
    <Container className="pt-1 pb-16 sm:pb-24">
      <section
        aria-labelledby="account-title"
        className="rounded-panel bg-primary-soft px-4.5 py-8 sm:rounded-hero sm:px-11 sm:py-11"
      >
        <p className="text-sm font-semibold tracking-[0.06em] text-primary uppercase">
          Your account
        </p>
        <h1
          id="account-title"
          className="mt-2.5 font-display text-[32px] leading-[1.08] font-extrabold tracking-[-0.03em] text-balance sm:text-[42px]"
        >
          {greetingName ? `Hi, ${greetingName}` : "Welcome to Nevile"}
        </h1>
        <p className="mt-3 max-w-[38em] text-[16px] leading-[1.55] text-muted">
          Book and pay local pros as a customer, or switch to business mode to take bookings
          yourself. One login does both.
        </p>
      </section>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1fr] lg:items-start">
        <Card as="section" aria-labelledby="details-title">
          <h2
            id="details-title"
            className="font-display text-[22px] leading-tight font-bold tracking-[-0.02em]"
          >
            Sign-in details
          </h2>
          <dl className="mt-4">
            <DetailRow label="Name">
              {greetingName || <span className="text-muted">Not added yet</span>}
            </DetailRow>
            <DetailRow label="Email">
              {email ? (
                <>
                  <span className="min-w-0 break-all">{email}</span>
                  {user.emailVerified ? <Badge variant="verified">Confirmed</Badge> : null}
                </>
              ) : (
                <span className="text-muted">Not added</span>
              )}
            </DetailRow>
            <DetailRow label="Mobile">
              {user.phoneNumber ? (
                <>
                  <span>{formatPhone(user.phoneNumber)}</span>
                  {user.phoneNumberVerified ? <Badge variant="verified">Confirmed</Badge> : null}
                </>
              ) : (
                <span className="text-muted">Not added</span>
              )}
            </DetailRow>
          </dl>
          <div className="mt-6 border-t border-border pt-5">
            <SignOutButton />
          </div>
        </Card>

        <Card as="section" aria-labelledby="preferences-title">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="preferences-title"
              className="font-display text-[22px] leading-tight font-bold tracking-[-0.02em]"
            >
              Preferences
            </h2>
            <Link
              href="/welcome"
              className="inline-flex min-h-11 items-center font-semibold text-primary"
            >
              Edit
            </Link>
          </div>
          <dl className="mt-4">
            <DetailRow label="Postal code">
              {onboarding.postalCode ?? <span className="text-muted">Not added yet</span>}
            </DetailRow>
            <DetailRow label="Interests">
              {interestNames.length > 0 ? (
                interestNames.join(", ")
              ) : (
                <span className="text-muted">None picked yet</span>
              )}
            </DetailRow>
          </dl>
          <div className="mt-5 border-t border-border pt-4">
            <h3 className="text-[15px] font-semibold">Email updates</h3>
            <div className="mt-2">
              <EmailUpdatesToggle consented={marketingConsent.consented} />
            </div>
          </div>
        </Card>

        <Card as="section" aria-labelledby="payment-title">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="payment-title"
              className="font-display text-[22px] leading-tight font-bold tracking-[-0.02em]"
            >
              Payment method
            </h2>
            <Link
              href="/account/card"
              className="inline-flex min-h-11 items-center font-semibold text-primary"
            >
              {card ? "Change" : "Add"}
            </Link>
          </div>
          <p className="mt-2 text-[16px]">
            {card ? (
              <>
                <span className="font-semibold">{card.label}</span>
                <span className="text-muted"> · expires {card.expires}</span>
              </>
            ) : (
              <span className="text-muted">No card saved</span>
            )}
          </p>
          <p className="mt-2 text-sm text-muted">Used for recurring visits and snow contracts.</p>
        </Card>

        <Card as="section" aria-labelledby="business-title">
          <h2
            id="business-title"
            className="font-display text-[22px] leading-tight font-bold tracking-[-0.02em]"
          >
            Business mode
          </h2>
          {businesses.length > 0 ? (
            <>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">
                You're a member of these businesses.
              </p>
              <ul className="mt-4 grid gap-2.5">
                {businesses.map(({ business, role }) => (
                  <li
                    key={business.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-input border border-border bg-ground px-4 py-3"
                  >
                    <span className="min-w-0 flex-1 font-semibold break-words">
                      {business.name}
                    </span>
                    <span className="text-sm text-muted">{PROVINCES[business.province].name}</span>
                    <Badge variant="neutral">{ROLE_LABELS[role]}</Badge>
                  </li>
                ))}
              </ul>
              <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
                <Button href="/business/calendar" size="lg" block>
                  Calendar and bookings
                </Button>
                <Button href="/business" size="lg" variant="secondary" block>
                  Manage your listing
                </Button>
              </div>
            </>
          ) : verified ? (
            <BusinessModeForm defaultOpen={intent === "business"} />
          ) : (
            <VerificationRequired
              className="mt-4"
              action="switch to business mode"
              email={contactEmail(user.email)}
            />
          )}
        </Card>
      </div>
    </Container>
  );
}
