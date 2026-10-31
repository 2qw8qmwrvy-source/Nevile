"use client";

import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Field, Textarea } from "@/components/ui/field.tsx";
import { useTRPC } from "@/lib/trpc.ts";

type Booking = inferRouterOutputs<AppRouter>["bookings"]["get"];

/** Cancel, confirm the job, or report a problem, whichever is allowed now. */
export function BookingActions({ booking }: { booking: Booking }) {
  const trpc = useTRPC();
  const router = useRouter();
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const done = () => router.refresh();
  const cancel = useMutation(trpc.bookings.cancel.mutationOptions({ onSuccess: done }));
  const confirm = useMutation(trpc.bookings.confirmDone.mutationOptions({ onSuccess: done }));
  const report = useMutation(trpc.bookings.reportProblem.mutationOptions({ onSuccess: done }));
  const error = cancel.error ?? confirm.error ?? report.error;
  const { actions } = booking;
  if (!actions.cancel && !actions.confirmDone && !actions.reportProblem) return null;

  return (
    <Card as="section" aria-labelledby="actions-title">
      <h2 id="actions-title" className="font-display text-[20px] font-bold">
        {actions.confirmDone ? "Is the job done?" : "Need to change plans?"}
      </h2>
      {error ? (
        <FormAlert tone="error" className="mt-3">
          {error.data?.zodError?.fieldErrors?.reason?.[0] ?? error.message}
        </FormAlert>
      ) : null}
      {actions.confirmDone ? (
        <div className="mt-3 flex flex-wrap gap-3">
          <Button
            onClick={() => confirm.mutate({ bookingId: booking.id })}
            disabled={confirm.isPending}
          >
            Yes, it's done
          </Button>
          {actions.reportProblem && !reporting ? (
            <Button variant="secondary" onClick={() => setReporting(true)}>
              Report a problem
            </Button>
          ) : null}
        </div>
      ) : null}
      {reporting ? (
        <form
          method="post"
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            report.mutate({ bookingId: booking.id, reason });
          }}
        >
          <Field
            label="What's wrong?"
            hint="The pro gets 3 days to put it right. Payment is held until then."
          >
            <Textarea
              rows={4}
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div className="flex gap-3">
            <Button type="submit" disabled={report.isPending}>
              Send to the pro
            </Button>
            <Button variant="ghost" onClick={() => setReporting(false)}>
              Never mind
            </Button>
          </div>
        </form>
      ) : null}
      {actions.cancel ? (
        <div className="mt-3">
          {confirmingCancel ? (
            <div className="nv-pop-in grid gap-3 rounded-input border border-border bg-ground p-4">
              <p className="text-[15px]">
                {booking.cancelQuote?.text ??
                  "Cancel this request? The hold on your card is released and you won't be charged."}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  className="bg-danger hover:bg-danger"
                  onClick={() => cancel.mutate({ bookingId: booking.id })}
                  disabled={cancel.isPending}
                >
                  {cancel.isPending ? "Cancelling…" : "Cancel booking"}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmingCancel(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setConfirmingCancel(true)}>
              Cancel booking
            </Button>
          )}
        </div>
      ) : null}
    </Card>
  );
}
