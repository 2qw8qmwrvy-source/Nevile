import type { AppRouter } from "@nevile/api";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import superjson from "superjson";

// Client-side tRPC + TanStack Query bindings. Import only from client components.
export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

function apiUrl(): string {
  if (typeof window !== "undefined") return "/api/trpc";
  return `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/api/trpc`;
}

export function makeTRPCClient() {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: apiUrl(), transformer: superjson })],
  });
}
