"use client";

import { useMutation } from "@tanstack/react-query";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { LockIcon } from "@/components/ui/icons.tsx";
import { useTRPC } from "@/lib/trpc.ts";

/** Opens the payment provider's secure card form; it comes back to `returnPath`. */
export function CardSetupButton({
  returnPath,
  label,
  variant = "primary",
}: {
  returnPath: string | null;
  label: string;
  variant?: "primary" | "secondary";
}) {
  const trpc = useTRPC();
  const start = useMutation(
    trpc.cards.startSetup.mutationOptions({
      onSuccess: (setup) => {
        if (setup.kind === "page") window.location.assign(setup.url);
      },
    }),
  );
  return (
    <div className="grid gap-3">
      {start.error ? <FormAlert tone="error">{start.error.message}</FormAlert> : null}
      <Button
        variant={variant}
        onClick={() => start.mutate({ kind: "page", returnPath })}
        disabled={start.isPending || start.isSuccess}
        aria-busy={start.isPending}
      >
        <LockIcon size={18} />
        {start.isPending || start.isSuccess ? "Opening secure page…" : label}
      </Button>
    </div>
  );
}
