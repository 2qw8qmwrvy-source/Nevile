import type { Metadata, Route } from "next";
import Link from "next/link";
import { AuthCard } from "../_components/auth-card.tsx";
import { SignUpForm } from "./sign-up-form.tsx";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Create a free Nevile account to book local home services or list your business.",
};

type SignUpPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const { intent } = await searchParams;
  const forBusiness = intent === "business";
  // New accounts land on the optional welcome flow (SPEC §16); business sign-ups start it
  // with "I run a business" picked.
  const next = (forBusiness ? "/welcome?intent=business" : "/welcome") as Route;
  const signInHref = `/sign-in?next=${encodeURIComponent(forBusiness ? "/account" : "/")}` as Route;
  const phoneHref = `/sign-in?method=phone&next=${encodeURIComponent(next)}` as Route;

  return (
    <AuthCard
      eyebrow={forBusiness ? "List your business" : "Join Nevile"}
      title={forBusiness ? "Start with your account" : "Create your account"}
      description={
        forBusiness
          ? "One account works for booking and for running your business. Once you're in, switch to business mode from your account page."
          : "Book local pros across Nova Scotia, pay in the app, and keep every job in one place."
      }
      footer={
        <div className="grid gap-2">
          <p>
            Prefer your phone?{" "}
            <Link href={phoneHref} className="font-semibold text-primary">
              Sign up with a text code
            </Link>
          </p>
          <p>
            Already have an account?{" "}
            <Link href={signInHref} className="font-semibold text-primary">
              Sign in
            </Link>
          </p>
        </div>
      }
    >
      <SignUpForm signInHref={signInHref} next={next} />
    </AuthCard>
  );
}
