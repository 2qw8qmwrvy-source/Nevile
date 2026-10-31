/** React bindings for the API: TanStack Query + tRPC context, and the app-wide provider. */
import type { AppRouter } from "@nevile/api";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { useSession } from "./auth.ts";
import { isApiError, makeTRPCClient } from "./trpc-client.ts";

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // 4xx answers (signed out, not found, invalid input) won't change on retry.
        retry: (failureCount, error) => {
          const status = isApiError(error) ? error.data?.httpStatus : undefined;
          if (status !== undefined && status < 500) return false;
          return failureCount < 2;
        },
      },
    },
  });
}

/** Refetch stale queries when the app returns to the foreground (TanStack's RN recipe). */
function useAppStateFocus() {
  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (status) => {
      focusManager.setFocused(status === "active");
    });
    return () => subscription.remove();
  }, []);
}

/**
 * Drops cached API data when the signed-in user changes (sign-out, or another account
 * signing in) so one person's data never shows for another.
 */
function SessionCacheGuard({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useSession();
  const userId = data?.user.id ?? null;
  const previous = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (isPending) return;
    const before = previous.current;
    previous.current = userId;
    // `undefined` is the first resolved session; signing in from signed-out has nothing to drop.
    if (before === undefined || before === null || before === userId) return;
    void queryClient.resetQueries();
  }, [isPending, userId, queryClient]);

  return children;
}

/** QueryClient + tRPC bindings; wrap the app once in the root layout. */
export function ApiProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const [trpcClient] = useState(makeTRPCClient);
  useAppStateFocus();
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <SessionCacheGuard>{children}</SessionCacheGuard>
      </TRPCProvider>
    </QueryClientProvider>
  );
}
