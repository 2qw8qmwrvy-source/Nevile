/**
 * Business tools in the app (SPEC §18–§20): which of the person's businesses a screen is
 * about, and what their role there allows. The server enforces every permission; this only
 * decides what to show.
 */
import { type Me, useMe } from "./me.ts";

export type BusinessMemberRole = Me["businesses"][number]["role"];

export type Membership = {
  business: { id: string; name: string; slug: string };
  role: BusinessMemberRole;
};

/** Owners and managers edit the listing, answer quotes, chat and manage payouts. */
export function canManage(role: BusinessMemberRole | undefined): boolean {
  return role === "owner" || role === "manager";
}

export const ROLE_NAMES: Record<BusinessMemberRole, string> = {
  owner: "Owner",
  manager: "Manager",
  crew: "Crew",
};

/**
 * The business a screen works on: the `businessId` route param when it's one of the
 * person's businesses, otherwise their first (preferring one they manage when `managed`).
 */
export function useBusiness(businessId: string | undefined, options: { managed?: boolean } = {}) {
  const { me, user } = useMe();
  const memberships: Membership[] = (me.data?.businesses ?? []).map((row) => ({
    business: { id: row.business.id, name: row.business.name, slug: row.business.slug },
    role: row.role,
  }));
  const pool = options.managed
    ? memberships.filter((membership) => canManage(membership.role))
    : memberships;
  const current =
    pool.find((membership) => membership.business.id === businessId) ?? pool[0] ?? null;
  return {
    signedIn: user !== null,
    loading: user !== null && me.isPending,
    error: me.error,
    verified: me.data?.verified ?? false,
    memberships,
    current,
  };
}
