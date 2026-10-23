"use client";

import {
  isWithinBounds,
  type LatLng,
  postalAreaOf,
  SERVICE_RADIUS_MAX_KM,
  SERVICE_RADIUS_MIN_KM,
  serviceAreaDescription,
} from "@nevile/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { MapView } from "@/components/map/map-view.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Input, Label } from "@/components/ui/field.tsx";
import { useTRPC } from "@/lib/trpc.ts";
import type { SectionProps } from "./listing-dashboard.tsx";
import { sectionTitleClass, useRefreshListing } from "./use-listing.ts";

const DEFAULT_RADIUS_KM = 25;
const roundPoint = (point: LatLng): LatLng => ({
  lat: Math.round(point.lat * 1e5) / 1e5,
  lng: Math.round(point.lng * 1e5) / 1e5,
});

/**
 * Where the business works (SPEC §2, §18): a pin and a radius. Start from a postal code
 * (works even if the map can't load), then drag the pin or tap the map to fine-tune.
 */
export function AreaSection({ listing, businessId }: SectionProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const refresh = useRefreshListing(businessId);
  const { serviceArea, canEdit } = listing;
  const [center, setCenter] = useState<LatLng | null>(
    serviceArea ? { lat: serviceArea.lat, lng: serviceArea.lng } : null,
  );
  const [radiusKm, setRadiusKm] = useState(serviceArea?.radiusKm ?? DEFAULT_RADIUS_KM);
  const [postal, setPostal] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = useMutation(
    trpc.listing.setServiceArea.mutationOptions({
      onSuccess: async () => {
        setSaved(true);
        await refresh();
      },
    }),
  );
  const area = useMemo(() => (center ? { center, radiusKm } : null), [center, radiusKm]);
  const dirty =
    center !== null &&
    (!serviceArea ||
      serviceArea.lat !== center.lat ||
      serviceArea.lng !== center.lng ||
      serviceArea.radiusKm !== radiusKm);

  function moveTo(point: LatLng) {
    if (!canEdit) return;
    setSaved(false);
    if (!isWithinBounds(point)) {
      setProblem("Put the pin in Nova Scotia. Nevile is only there for now.");
      return;
    }
    setProblem(null);
    setCenter(roundPoint(point));
  }

  async function findPostal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!postalAreaOf(postal)) {
      setProblem("Enter a postal code like B4A 1A1.");
      return;
    }
    setFinding(true);
    try {
      const result = await queryClient.fetchQuery(
        trpc.search.area.queryOptions({ postalCode: postal }),
      );
      if (result.kind === "found") moveTo(result.center);
      else if (result.kind === "outside") setProblem("That postal code is outside Nova Scotia.");
      else setProblem("We don't know that postal code yet. Try a nearby one, or tap the map.");
    } catch {
      setProblem("We couldn't look that up. Please try again.");
    } finally {
      setFinding(false);
    }
  }

  return (
    <Card as="section" id="area" aria-labelledby="area-title" className="scroll-mt-24">
      <h2 id="area-title" className={sectionTitleClass}>
        Service area
      </h2>
      <p className="mt-1.5 text-[15px] text-muted">
        Customers see you when their address is inside this circle. Your pin is never shown exactly:
        search shows it about 1 km off, and your page shows only the area.
      </p>

      {canEdit ? (
        <form
          method="post"
          onSubmit={findPostal}
          noValidate
          className="mt-5 flex flex-wrap items-end gap-3"
        >
          <div className="w-44">
            <Label htmlFor="area-postal">Start from a postal code</Label>
            <Input
              id="area-postal"
              value={postal}
              placeholder="B4A 1A1"
              maxLength={7}
              autoCapitalize="characters"
              className="uppercase"
              onChange={(event) => setPostal(event.target.value)}
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            shape="rounded"
            className="h-12"
            disabled={finding}
          >
            {finding ? "Finding…" : "Move pin there"}
          </Button>
        </form>
      ) : null}

      <MapView
        label="Map of your service area. Tap the map or drag the pin to move it."
        area={area}
        onMovePin={canEdit ? moveTo : undefined}
        className="mt-4 h-80 sm:h-96"
      />

      <div className="mt-4 grid gap-2">
        <label
          htmlFor="area-radius"
          className="flex items-baseline justify-between text-[15px] font-semibold"
        >
          How far you'll travel
          <span className="text-primary">{radiusKm} km</span>
        </label>
        <input
          id="area-radius"
          type="range"
          min={SERVICE_RADIUS_MIN_KM}
          max={SERVICE_RADIUS_MAX_KM}
          step={1}
          value={radiusKm}
          disabled={!canEdit}
          onChange={(event) => {
            setSaved(false);
            setRadiusKm(Number(event.target.value));
          }}
          className="h-11 w-full cursor-pointer accent-primary"
        />
      </div>

      <p className="mt-2 text-[15px]">
        {center ? (
          serviceArea && !dirty ? (
            <strong className="font-semibold">{serviceArea.description}</strong>
          ) : (
            <span>
              {serviceAreaDescription(radiusKm, null)} from your pin
              <span className="text-muted"> (not saved yet)</span>
            </span>
          )
        ) : (
          <span className="text-muted">No pin yet. Start from a postal code or tap the map.</span>
        )}
      </p>

      {problem ? (
        <FormAlert tone="error" className="mt-3">
          {problem}
        </FormAlert>
      ) : null}
      {save.error ? (
        <FormAlert tone="error" className="mt-3">
          {save.error.data?.zodError
            ? "Put the pin in Nova Scotia and pick 1 to 100 km."
            : save.error.message}
        </FormAlert>
      ) : null}
      {saved && !dirty ? (
        <FormAlert tone="success" className="mt-3">
          Service area saved.
        </FormAlert>
      ) : null}
      {canEdit ? (
        <div className="mt-4">
          <Button
            disabled={!dirty || save.isPending}
            aria-busy={save.isPending}
            onClick={() => center && save.mutate({ businessId, center, radiusKm })}
          >
            {save.isPending ? "Saving…" : "Save service area"}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
