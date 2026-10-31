"use client";

import { useMutation } from "@tanstack/react-query";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button.tsx";
import { useTRPC } from "@/lib/trpc.ts";

const RETRIES = 10;

/** Confirms the payment went through, then shows the booking. */
export function CheckoutReturn({ sessionId }: { sessionId: string }) {
  const trpc = useTRPC();
  const router = useRouter();
  const attempts = useRef(0);
  const finish = useMutation(
    trpc.bookings.finishCheckout.mutationOptions({
      onSuccess: (outcome) => {
        if ("bookingId" in outcome) {
          router.replace(`/bookings/${outcome.bookingId}?new=1` as Route);
        } else if (outcome.status === "pending" && attempts.current < RETRIES) {
          // The payment provider can take a moment to confirm.
          attempts.current += 1;
          setTimeout(() => finish.mutate({ sessionId }), 1500);
        }
      },
    }),
  );
  const mutate = finish.mutate;
  useEffect(() => {
    if (sessionId) mutate({ sessionId });
  }, [mutate, sessionId]);

  const outcome = finish.data;
  const waiting =
    !outcome ||
    finish.isPending ||
    (outcome.status === "pending" && attempts.current < RETRIES) ||
    "bookingId" in outcome;
  return (
    <section
      aria-live="polite"
      className="mx-auto max-w-xl rounded-panel bg-primary-soft px-6 py-10 text-center"
    >
      {!sessionId ? (
        <p>There&apos;s nothing to finish here.</p>
      ) : finish.isError ? (
        <>
          <h1 className="font-display text-[26px] font-bold">
            We couldn&apos;t check your payment
          </h1>
          <p className="mt-2 text-muted">{finish.error.message}</p>
          <Button className="mt-5" onClick={() => finish.mutate({ sessionId })}>
            Try again
          </Button>
        </>
      ) : waiting ? (
        <>
          <h1 className="font-display text-[26px] font-bold">Finishing your booking…</h1>
          <p className="mt-2 text-muted">This takes a few seconds. Please keep this page open.</p>
        </>
      ) : outcome.status === "expired" ? (
        <>
          <h1 className="font-display text-[26px] font-bold">That checkout expired</h1>
          <p className="mt-2 text-muted">You weren&apos;t charged. Pick a time again to book.</p>
          <Button className="mt-5" href="/search">
            Find a pro
          </Button>
        </>
      ) : outcome.status === "refunded" ? (
        <>
          <h1 className="font-display text-[26px] font-bold">That time was taken</h1>
          <p className="mt-2 text-muted">{outcome.message} We&apos;ve refunded you in full.</p>
          <Button className="mt-5" href="/search">
            Find another time
          </Button>
        </>
      ) : (
        <>
          <h1 className="font-display text-[26px] font-bold">
            We&apos;re still waiting for the payment
          </h1>
          <p className="mt-2 text-muted">
            If you paid, your booking will appear under Your bookings shortly, and we&apos;ll email
            you.
          </p>
          <Button className="mt-5" href={"/bookings" as Route}>
            Your bookings
          </Button>
        </>
      )}
    </section>
  );
}
