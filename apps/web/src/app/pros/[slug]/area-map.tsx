"use client";

import type { LatLng } from "@nevile/core";
import { useMemo } from "react";
import { MapView } from "@/components/map/map-view.tsx";

type AreaMapProps = { center: LatLng; radiusKm: number; name: string };

/** The rough area a business serves; the centre is rounded, never its base address. */
export function AreaMap({ center, radiusKm, name }: AreaMapProps) {
  const area = useMemo(() => ({ center, radiusKm }), [center, radiusKm]);
  return <MapView label={`Map of the area ${name} serves`} area={area} className="mt-3 h-56" />;
}
