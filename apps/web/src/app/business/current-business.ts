import "server-only";
import { contactEmail } from "@nevile/auth/client";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth.ts";
import { getServerCaller } from "@/lib/trpc-server.ts";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The signed-in member's business for a business-mode page (`?b=<id>` picks one of
 * several), or a redirect: to sign in, or to the account page to create a business.
 */
export async function currentBusiness(path: string, searchParams: SearchParams) {
  if (!(await getSession())) redirect(`/sign-in?next=${encodeURIComponent(path)}`);
  const caller = await getServerCaller();
  const { user, businesses, verified } = await caller.me.get();
  const requested = typeof searchParams.b === "string" ? searchParams.b : undefined;
  const selected = businesses.find(({ business }) => business.id === requested) ?? businesses[0];
  if (verified && !selected) redirect("/account?intent=business");
  return {
    caller,
    verified,
    email: contactEmail(user.email),
    businesses: businesses.map(({ business, role }) => ({
      id: business.id,
      name: business.name,
      role,
    })),
    selected: selected
      ? { id: selected.business.id, name: selected.business.name, role: selected.role }
      : null,
  };
}
