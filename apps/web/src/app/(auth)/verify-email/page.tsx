import { auth } from "@nevile/auth";
import { isAPIError } from "better-auth/api";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button.tsx";
import { AuthCard } from "../_components/auth-card.tsx";
import { FormAlert } from "../_components/form-alert.tsx";
import { ResendVerificationForm } from "./resend-form.tsx";

export const metadata: Metadata = {
  title: "Confirm your email",
  robots: { index: false, follow: false },
  // The URL carries a one-time token; never send it on in a Referer header.
  referrer: "no-referrer",
};

type Outcome = "verified" | "expired" | "invalid";

/** Confirms the token from a verification email. Already-verified addresses also succeed. */
async function confirm(token: string): Promise<Outcome> {
  try {
    await auth.api.verifyEmail({ query: { token } });
    return "verified";
  } catch (error) {
    if (!isAPIError(error)) throw error;
    return error.body?.code === "TOKEN_EXPIRED" ? "expired" : "invalid";
  }
}

type VerifyEmailPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { token } = await searchParams;
  const value = Array.isArray(token) ? token[0] : token;

  if (!value) {
    return (
      <AuthCard
        eyebrow="Confirm your email"
        icon="clock"
        title="Check your inbox"
        description="Open the link we emailed you to confirm your address. Didn't get it? Check spam, or send a new one."
        footer={
          <Link href="/sign-in" className="font-semibold text-primary">
            Back to sign in
          </Link>
        }
      >
        <ResendVerificationForm />
      </AuthCard>
    );
  }

  const outcome = await confirm(value);

  if (outcome === "verified") {
    return (
      <AuthCard
        eyebrow="Email confirmed"
        icon="check"
        title="You're all set"
        description="Your email address is confirmed. Sign in with your email and password to continue."
      >
        <div className="grid gap-4">
          <FormAlert tone="success">Thanks for confirming your email.</FormAlert>
          <Button href="/sign-in" size="lg" block>
            Sign in
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      eyebrow="Confirm your email"
      icon="warning"
      title={outcome === "expired" ? "This link has expired" : "This link doesn't work"}
      description={
        outcome === "expired"
          ? "Confirmation links last 1 hour. Enter your email and we'll send you a fresh one."
          : "It may have been copied incompletely or replaced by a newer link. Enter your email to get a new one."
      }
      footer={
        <Link href="/sign-in" className="font-semibold text-primary">
          Back to sign in
        </Link>
      }
    >
      <ResendVerificationForm />
    </AuthCard>
  );
}
