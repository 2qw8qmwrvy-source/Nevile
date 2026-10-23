/**
 * Distances and locations for search (SPEC §18). Points are WGS84 degrees; distances are
 * great-circle kilometres on a spherical Earth, which is accurate to well under 1% at
 * Nova Scotia's scale.
 */
import { z } from "zod";
import { normalizePostalCode } from "./schemas.ts";

export type LatLng = { lat: number; lng: number };

/** Mean Earth radius (IUGG), km. */
const EARTH_RADIUS_KM = 6371.0088;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export function isValidLatLng(point: LatLng): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180
  );
}

/** Great-circle distance in km (haversine). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type BoundingBox = { minLat: number; maxLat: number; minLng: number; maxLng: number };

/**
 * A box that contains every point within `radiusKm` of `center`, for a cheap index
 * prefilter before the exact distance check. Slightly generous, never too small.
 */
export function boundingBox(center: LatLng, radiusKm: number): BoundingBox {
  const latDelta = (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  const cosLat = Math.max(Math.cos(toRadians(center.lat)), 0.01);
  const lngDelta = latDelta / cosLat;
  return {
    minLat: Math.max(-90, center.lat - latDelta),
    maxLat: Math.min(90, center.lat + latDelta),
    minLng: Math.max(-180, center.lng - lngDelta),
    maxLng: Math.min(180, center.lng + lngDelta),
  };
}

/**
 * Rounds a point for public display (SPEC §18): two decimals is about 1.1 km north–south
 * and 0.8 km east–west in Nova Scotia, so a sole operator's home is never pinpointed.
 */
export function approximateLocation(point: LatLng, decimals = 2): LatLng {
  const factor = 10 ** decimals;
  return {
    lat: Math.round(point.lat * factor) / factor,
    lng: Math.round(point.lng * factor) / factor,
  };
}

/**
 * Rough rectangle around Nova Scotia (including Cape Breton and Sable Island's latitude
 * band). Used to reject pins that are obviously elsewhere; it also covers slivers of New
 * Brunswick and PEI, so it is a sanity check, not a border.
 */
export const NOVA_SCOTIA_BOUNDS: BoundingBox = {
  minLat: 43.35,
  maxLat: 47.1,
  minLng: -66.45,
  maxLng: -59.65,
};

export function isWithinBounds(point: LatLng, bounds: BoundingBox = NOVA_SCOTIA_BOUNDS): boolean {
  return (
    point.lat >= bounds.minLat &&
    point.lat <= bounds.maxLat &&
    point.lng >= bounds.minLng &&
    point.lng <= bounds.maxLng
  );
}

/** A point inside the launch region's rough bounds. */
export const launchPointSchema = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
  })
  .refine((point) => isWithinBounds(point), {
    message: "Choose a location in Nova Scotia.",
  });

/** "b3h 1a1" → "B3H"; null for anything that isn't a Canadian postal code or area. */
export function postalAreaOf(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/\s+/g, "");
  // Forward sortation area: Canada Post never uses D, F, I, O, Q or U, nor W/Z first.
  if (/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]$/.test(compact)) return compact;
  const normalized = normalizePostalCode(value);
  return normalized ? normalized.slice(0, 3) : null;
}

/** "Under 1 km", "4 km", "23 km": rounded, because area centres are approximate. */
export function formatDistanceKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "";
  if (km < 1) return "Under 1 km";
  return `${Math.round(km)} km`;
}
