"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc.ts";

/** Reloads the dashboard's listing after a change. */
export function useRefreshListing(businessId: string): () => Promise<void> {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: trpc.listing.get.queryKey({ businessId }) });
}

/** First server-side message for a field, from a tRPC error's Zod details. */
export function fieldError(
  error: {
    data?: { zodError?: { fieldErrors?: Record<string, string[] | undefined> } | null } | null;
  } | null,
  field: string,
): string | undefined {
  return error?.data?.zodError?.fieldErrors?.[field]?.[0];
}

/** Heading + intro shared by every dashboard section. */
export const sectionTitleClass =
  "font-display text-[22px] leading-tight font-bold tracking-[-0.02em]";
