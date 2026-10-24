/** The listing editor's shared data (SPEC §18): one query, refreshed after every change. */
import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { useQueryClient } from "@tanstack/react-query";
import { Alert } from "react-native";

import { useTRPC } from "./trpc.tsx";

export type Listing = inferRouterOutputs<AppRouter>["listing"]["get"];

/**
 * After a listing change: refresh it, and say so when the change took the listing out of
 * search (the server unpublishes a listing that's no longer ready).
 */
export function useListingChanged(businessId: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return async (result?: { unpublished?: boolean }) => {
    if (result?.unpublished) {
      Alert.alert(
        "Your listing is hidden",
        "It's missing something it needs to show in search. Check Listing to publish it again.",
      );
    }
    await queryClient.invalidateQueries({ queryKey: trpc.listing.get.queryKey({ businessId }) });
  };
}
