import { haversineKm, isLaunchProvince, type LatLng, postalAreaOf } from "@nevile/core";
import { type DbExecutor, eq, like, postalAreas } from "@nevile/db";

export type ResolvedArea = {
  /** The area the customer typed, e.g. "B3H". */
  requested: string;
  /** The known area used for the search; differs from `requested` on a fallback. */
  code: string;
  placeName: string;
  point: LatLng;
  /** The centre point is from the starter list, not Statistics Canada data. */
  approximate: boolean;
};

export type AreaLookup =
  | { kind: "found"; area: ResolvedArea }
  /** A valid NS code we have no area for (falls back to all of Nova Scotia). */
  | { kind: "unknown"; requested: string }
  /** A valid code outside the launch region (SPEC §2). */
  | { kind: "outside"; requested: string }
  | { kind: "invalid" };

function toResolved(requested: string, row: typeof postalAreas.$inferSelect): ResolvedArea {
  return {
    requested,
    code: row.code,
    placeName: row.placeName,
    point: { lat: row.lat, lng: row.lng },
    approximate: row.approximate,
  };
}

/**
 * Where a postal code is, for search (SPEC §18): the exact area, else the known area with
 * the same first two characters whose last letter is nearest in code order (neighbouring
 * codes are usually neighbouring places), else unknown.
 */
export async function lookupPostalArea(db: DbExecutor, postalCode: string): Promise<AreaLookup> {
  const requested = postalAreaOf(postalCode);
  if (!requested) return { kind: "invalid" };
  // Postal codes starting with B are Nova Scotia; others are outside the launch region.
  if (!requested.startsWith("B")) return { kind: "outside", requested };

  const [exact] = await db
    .select()
    .from(postalAreas)
    .where(eq(postalAreas.code, requested))
    .limit(1);
  if (exact) return { kind: "found", area: toResolved(requested, exact) };

  const siblings = await db
    .select()
    .from(postalAreas)
    .where(like(postalAreas.code, `${requested.slice(0, 2)}%`));
  const target = requested.charCodeAt(2);
  const nearest = siblings
    .filter((row) => isLaunchProvince(row.province))
    .sort(
      (a, b) =>
        Math.abs(a.code.charCodeAt(2) - target) - Math.abs(b.code.charCodeAt(2) - target) ||
        a.code.localeCompare(b.code),
    )[0];
  return nearest
    ? { kind: "found", area: toResolved(requested, nearest) }
    : { kind: "unknown", requested };
}

/** Place name of the known area whose centre is closest to `point` ("Bedford"). */
export async function nearestPlaceName(db: DbExecutor, point: LatLng): Promise<string | null> {
  const rows = await db
    .select({ placeName: postalAreas.placeName, lat: postalAreas.lat, lng: postalAreas.lng })
    .from(postalAreas)
    .where(eq(postalAreas.province, "NS"));
  let best: { placeName: string; km: number } | null = null;
  for (const row of rows) {
    const km = haversineKm(point, row);
    if (!best || km < best.km) best = { placeName: row.placeName, km };
  }
  return best?.placeName ?? null;
}
