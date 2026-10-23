"use client";

import { MARKETING_CONSENT_SENDER, MARKETING_CONSENT_STATEMENT } from "@nevile/core";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Checkbox } from "@/components/ui/field.tsx";
import { useTRPC } from "@/lib/trpc.ts";

/**
 * Give or withdraw CASL marketing consent (SPEC §17). Withdrawing is always one click; the
 * server records the consent text version and time.
 */
export function EmailUpdatesToggle({ consented }: { consented: boolean }) {
  const trpc = useTRPC();
  const router = useRouter();
  const [checked, setChecked] = useState(consented);
  const update = useMutation(
    trpc.profile.setMarketingConsent.mutationOptions({
      onSuccess: (state) => {
        setChecked(state.consented);
        router.refresh();
      },
      onError: () => setChecked((value) => !value),
    }),
  );
  return (
    <div>
      <Checkbox
        name="marketingConsent"
        checked={checked}
        disabled={update.isPending}
        onChange={(event) => {
          setChecked(event.target.checked);
          update.mutate({ consent: event.target.checked });
        }}
        label={MARKETING_CONSENT_STATEMENT}
        description={MARKETING_CONSENT_SENDER}
      />
      <p role="status" className="mt-1 ml-8 text-sm text-muted">
        {update.isError
          ? "We couldn't save that. Try again."
          : update.isSuccess
            ? checked
              ? "Thanks, you're subscribed."
              : "You're unsubscribed from Nevile emails."
            : ""}
      </p>
    </div>
  );
}
