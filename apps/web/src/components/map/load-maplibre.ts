import type { LatLng } from "@nevile/core";

type MapLibre = typeof import("maplibre-gl");

/** OpenStreetMap data styled by OpenFreeMap: free, no key (SPEC §18). */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** Whole-province view used before there is anything to show. */
export const NOVA_SCOTIA_VIEW = { center: [-63.25, 45.05] as [number, number], zoom: 5.7 };

let loading: Promise<MapLibre> | null = null;

/**
 * Loads MapLibre on demand (it's large, and only pages with a map need it). Its worker is
 * served from public/ (copied there by next.config.ts).
 */
export function loadMapLibre(): Promise<MapLibre> {
  loading ??= import("maplibre-gl").then((lib) => {
    lib.setWorkerUrl(`/maplibre/worker-${process.env.NEXT_PUBLIC_MAPLIBRE_VERSION}.mjs`);
    return lib;
  });
  return loading;
}

export type PolygonFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
};

/** A circle of `radiusKm` around `center`, as a GeoJSON polygon (for the area overlay). */
export function circlePolygon(center: LatLng, radiusKm: number, steps = 72): PolygonFeature {
  const earthKm = 6371.0088;
  const angular = radiusKm / earthKm;
  const lat1 = (center.lat * Math.PI) / 180;
  const lng1 = (center.lng * Math.PI) / 180;
  const ring: [number, number][] = [];
  for (let step = 0; step <= steps; step += 1) {
    const bearing = (2 * Math.PI * step) / steps;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
        Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
      );
    ring.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
