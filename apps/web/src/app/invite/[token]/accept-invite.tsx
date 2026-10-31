"use client";

import { useMutation } from "@tanstack/react-query";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useTRPC } from "@/lib/trpc.ts";

export function AcceptInvite({ token }: { token: string }) {
  const trpc = useTRPC();
  const router = useRouter();
  const accept = useMutation(
    trpc.team.acceptInvite.mutationOptions({
      onSuccess: ({ businessId }) => router.push(`/business/calendar?b=${businessId}` as Route),
    }),
  );
  return (
    <div className="mt-6 grid gap-3">
      {accept.error ? <FormAlert tone="error">{accept.error.message}</FormAlert> : null}
      <Button size="lg" onClick={() => accept.mutate({ token })} disabled={accept.isPending}>
        {accept.isPending ? "Joining…" : "Accept invite"}
      </Button>
    </div>
  );
}
