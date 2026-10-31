import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionOrNull, safeNextPath } from "@/lib/auth.ts";
import { AuthCard } from "../_components/auth-card.tsx";
import { type SignInMethod, SignInTabs } from "./sign-in-tabs.tsx";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Nevile with your email and password or a code sent to your phone.",
};

type SignInPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  if (await getSessionOrNull()) redirect(next as Route);
  const method: SignInMethod = params.method === "phone" ? "phone" : "email";
  const signUpHref = (
    next.includes("intent=business") ? "/sign-up?intent=business" : "/sign-up"
  ) as Route;

  return (
    <AuthCard
      eyebrow="Welcome back"
      title="Sign in to Nevile"
      description="Use your email and password, or get a one-time code by text message."
      footer={
        <p>
          New to Nevile?{" "}
          <Link href={signUpHref} className="font-semibold text-primary">
            Create an account
          </Link>
        </p>
      }
    >
      <SignInTabs initialMethod={method} next={next} />
    </AuthCard>
  );
}
