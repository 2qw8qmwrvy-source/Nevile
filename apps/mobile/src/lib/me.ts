/**
 * The signed-in account as the API sees it (`me.get`): verification, onboarding, consent and
 * business memberships. One query shared by every screen, so they always agree.
 */
import type { AppRouter } from "@nevile/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferOutput, TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useEffect } from "react";

import { useSession } from "./auth.ts";
import { useTRPC } from "./trpc.tsx";
import { apiErrorCode } from "./trpc-client.ts";

export type Me = inferOutput<TRPCOptionsProxy<AppRouter>["me"]["get"]>;

export function useMe() {
  const trpc = useTRPC();
  const session = useSession();
  const user = session.data?.user ?? null;
  const me = useQuery({
    ...trpc.me.get.queryOptions(),
    enabled: user !== null,
    // While unverified, re-check every time the app comes back to the foreground: people
    // usually confirm their email in another app and come straight back.
    refetchOnWindowFocus: (query) => (query.state.data?.verified === false ? "always" : true),
  });

  // The server no longer accepts the stored session (expired or revoked elsewhere): reload
  // it, which signs this device out if the server agrees.
  const unauthorized = apiErrorCode(me.error) === "UNAUTHORIZED";
  const refetchSession = session.refetch;
  useEffect(() => {
    if (unauthorized) void refetchSession();
  }, [unauthorized, refetchSession]);

  return { session, user, me, queryKey: trpc.me.get.queryKey() };
}

/** Writes a fresh piece of `me.get` into the cache after a mutation returns it. */
export function useUpdateMe() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return (update: (current: Me) => Me) => {
    queryClient.setQueryData(trpc.me.get.queryKey(), (current) =>
      current ? update(current) : current,
    );
  };
}
