"use client";

import { useMutation } from "@tanstack/react-query";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button.tsx";
import { useTRPC } from "@/lib/trpc.ts";

const RETRIES = 10;

/** Confirms the card was saved, then goes back where the customer came from. */
export function CardReturn({ setupId }: { setupId: string }) {
  const trpc = useTRPC();
  const router = useRouter();
  const attempts = useRef(0);
  const finish = useMutation(
    trpc.cards.finishSetup.mutationOptions({
      onSuccess: (outcome) => {
        if (outcome.status === "saved") {
          const back = outcome.returnPath
            ? `${outcome.returnPath}${outcome.returnPath.includes("?") ? "&" : "?"}card=saved`
            : "/account/card?saved=1";
          router.replace(back as Route);
        } else if (outcome.status === "pending" && attempts.current < RETRIES) {
          // The payment provider can take a moment to confirm.
          attempts.current += 1;
          setTimeout(() => finish.mutate({ setupId }), 1500);
        }
      },
    }),
  );
  const mutate = finish.mutate;
  useEffect(() => {
    if (setupId) mutate({ setupId });
  }, [mutate, setupId]);

  const outcome = finish.data;
  const waiting =
    !outcome ||
    finish.isPending ||
    outcome.status === "saved" ||
    (outcome.status === "pending" && attempts.current < RETRIES);
  return (
    <section
      aria-live="polite"
      className="mx-auto max-w-xl rounded-panel bg-primary-soft px-6 py-10 text-center"
    >
      {!setupId ? (
        <p>There&apos;s nothing to finish here.</p>
      ) : finish.isError ? (
        <>
          <h1 className="font-display text-[26px] font-bold">We couldn&apos;t check your card</h1>
          <p className="mt-2 text-muted">{finish.error.message}</p>
          <Button className="mt-5" onClick={() => finish.mutate({ setupId })}>
            Try again
          </Button>
        </>
      ) : waiting ? (
        <>
          <h1 className="font-display text-[26px] font-bold">Saving your card…</h1>
          <p className="mt-2 text-muted">This takes a few seconds. Please keep this page open.</p>
        </>
      ) : (
        <>
          <h1 className="font-display text-[26px] font-bold">
            {outcome.status === "expired" ? "That card form expired" : "Your card wasn't saved"}
          </h1>
          <p className="mt-2 text-muted">Nothing was charged. Try adding it again.</p>
          <Button className="mt-5" href={"/account/card" as Route}>
            Payment method
          </Button>
        </>
      )}
    </section>
  );
}
