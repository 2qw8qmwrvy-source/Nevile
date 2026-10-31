"use client";

import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { PrivatePhotoPicker, type UploadedPhoto } from "@/components/photos/private-photos.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useTRPC } from "@/lib/trpc.ts";

type Stop = inferRouterOutputs<AppRouter>["businessBookings"]["snowRoute"]["stops"][number];

function StopCard({
  stop,
  businessId,
  canReorder,
  onMove,
  first,
  last,
}: {
  stop: Stop;
  businessId: string;
  canReorder: boolean;
  onMove: (by: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const cleared = useMutation(
    trpc.businessBookings.markCleared.mutationOptions({
      onSuccess: async () => {
        setPhotos([]);
        await queryClient.invalidateQueries({
          queryKey: trpc.businessBookings.snowRoute.queryKey({ businessId }),
        });
      },
    }),
  );
  return (
    <li>
      <Card padding="sm" className="sm:p-5" aria-label={`Stop ${stop.stop}: ${stop.address[0]}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <span
              aria-hidden="true"
              className="grid size-9 flex-none place-items-center rounded-full bg-primary-soft font-display text-[17px] font-bold text-primary"
            >
              {stop.stop}
            </span>
            <div className="min-w-0">
              <address className="text-[16px] font-semibold not-italic">
                {stop.address.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </address>
              <p className="text-sm text-muted">
                {stop.customer.firstName} · {stop.title} · from {stop.triggerCm} cm
              </p>
              <p className="text-sm text-muted">
                {stop.visits === 0
                  ? "No visits yet this season"
                  : `${stop.visits} ${stop.visits === 1 ? "visit" : "visits"} · last cleared ${stop.lastClearedLabel}`}
              </p>
              {stop.notes ? (
                <p className="mt-1 text-sm whitespace-pre-line">“{stop.notes}”</p>
              ) : null}
            </div>
          </div>
          {canReorder ? (
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={first}
                aria-label={`Move stop ${stop.stop} up`}
                onClick={() => onMove(-1)}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={last}
                aria-label={`Move stop ${stop.stop} down`}
                onClick={() => onMove(1)}
              >
                ↓
              </Button>
            </div>
          ) : null}
        </div>
        {stop.paused ? (
          <FormAlert tone="error" className="mt-3">
            Paused: the customer&apos;s card didn&apos;t go through. Don&apos;t clear it until they
            update it.
          </FormAlert>
        ) : !stop.inSeason ? (
          <p className="mt-3 text-sm text-muted">
            Outside the contract&apos;s season ({stop.season}).
          </p>
        ) : stop.justCleared && !cleared.isSuccess ? (
          <p className="mt-3 text-sm text-muted">
            Cleared a moment ago. You can log it again after 30 minutes.
          </p>
        ) : null}
        {cleared.error ? (
          <FormAlert tone="error" className="mt-3">
            {cleared.error.message}
          </FormAlert>
        ) : null}
        {cleared.isSuccess ? (
          <FormAlert tone="success" className="mt-3">
            Logged. The customer has 48 hours to confirm.
          </FormAlert>
        ) : null}
        {stop.canMark ? (
          <div className="mt-3 flex flex-wrap items-start gap-3">
            <Button
              disabled={cleared.isPending}
              onClick={() =>
                cleared.mutate({
                  businessId,
                  bookingId: stop.bookingId,
                  photoIds: photos.map((photo) => photo.id),
                })
              }
            >
              {cleared.isPending ? "Logging…" : "Cleared"}
            </Button>
            <PrivatePhotoPicker
              purpose="visits"
              photos={photos}
              onChange={setPhotos}
              max={3}
              label="Add a photo"
              compact
            />
          </div>
        ) : null}
      </Card>
    </li>
  );
}

/** The snow route: active contracts in order, each marked Cleared after a storm. */
export function SnowRoute({ businessId, canReorder }: { businessId: string; canReorder: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const route = useQuery(trpc.businessBookings.snowRoute.queryOptions({ businessId }));
  const reorder = useMutation(
    trpc.businessBookings.reorderRoute.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.businessBookings.snowRoute.queryKey({ businessId }),
        }),
    }),
  );
  const stops = route.data?.stops ?? [];

  function move(index: number, by: -1 | 1) {
    const order = stops.map((stop) => stop.bookingId);
    const target = index + by;
    const [moved] = order.splice(index, 1);
    if (!moved || target < 0 || target > order.length) return;
    order.splice(target, 0, moved);
    reorder.mutate({ businessId, bookingIds: order });
  }

  return (
    <section aria-labelledby="route-title">
      <h1
        id="route-title"
        className="font-display text-[30px] leading-[1.1] font-extrabold tracking-[-0.03em] sm:text-[36px]"
      >
        Snow route
      </h1>
      <p className="mt-2 max-w-[42em] text-[16px] text-muted">
        Your active snow contracts in the order you clear them. After each storm, mark every address
        Cleared (a photo helps); the customer confirms it or reports a problem within 48 hours.
      </p>
      {reorder.error ? (
        <FormAlert tone="error" className="mt-4">
          {reorder.error.message}
        </FormAlert>
      ) : null}
      {route.isPending ? (
        <div className="mt-5 grid gap-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : route.isError ? (
        <FormAlert tone="error" className="mt-5">
          {route.error.message}
        </FormAlert>
      ) : stops.length === 0 ? (
        <div className="mt-6 rounded-panel border border-dashed border-field bg-surface px-5 py-10 text-center">
          <p className="text-[17px] font-semibold">No active contracts yet</p>
          <p className="mt-1 text-muted">
            List a Snow &amp; Ice Removal service as a seasonal contract on your listing, or send
            contract terms in a quote. Accepted contracts show up here.
          </p>
        </div>
      ) : (
        <ol className="mt-5 grid gap-3">
          {stops.map((stop, index) => (
            <StopCard
              key={stop.bookingId}
              stop={stop}
              businessId={businessId}
              canReorder={canReorder && !reorder.isPending}
              first={index === 0}
              last={index === stops.length - 1}
              onMove={(by) => move(index, by)}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
