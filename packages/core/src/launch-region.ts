/**
 * Launch region — SPEC §2. Nevile launches in Nova Scotia only; sign-up, service areas and
 * job addresses must be inside the launch provinces, checked on the server. Expanding is a
 * change to `LAUNCH_PROVINCES`, not a rewrite.
 */
import { normalizePostalCode } from "./contact-formats.ts";
import type { ProvinceCode } from "./tax.ts";

export const LAUNCH_PROVINCES = ["NS"] as const satisfies readonly ProvinceCode[];
export type LaunchProvince = (typeof LAUNCH_PROVINCES)[number];

/** Shown when a postal code, service area or address is outside the launch provinces. */
export const OUTSIDE_LAUNCH_REGION_MESSAGE = "Nevile is only in Nova Scotia for now.";

/**
 * Province by the first letter of a postal code (Canada Post's postal districts).
 * "X" covers both the Northwest Territories and Nunavut, which a single letter cannot
 * tell apart (X0A–X0C are Nunavut); it maps to "NT". Neither is a launch province, so the
 * launch check is unaffected.
 */
const PROVINCE_BY_POSTAL_DISTRICT: Readonly<Record<string, ProvinceCode>> = {
  A: "NL",
  B: "NS",
  C: "PE",
  E: "NB",
  G: "QC",
  H: "QC",
  J: "QC",
  K: "ON",
  L: "ON",
  M: "ON",
  N: "ON",
  P: "ON",
  R: "MB",
  S: "SK",
  T: "AB",
  V: "BC",
  X: "NT",
  Y: "YT",
};

/** The province of a Canadian postal code (any common layout), or null if it is invalid. */
export function postalCodeProvince(postalCode: string): ProvinceCode | null {
  const normalized = normalizePostalCode(postalCode);
  if (!normalized) return null;
  return PROVINCE_BY_POSTAL_DISTRICT[normalized.charAt(0)] ?? null;
}

export function isLaunchProvince(
  province: unknown,
  provinces: readonly ProvinceCode[] = LAUNCH_PROVINCES,
): boolean {
  return typeof province === "string" && (provinces as readonly string[]).includes(province);
}

/** Whether a postal code is valid and inside the launch provinces. */
export function isLaunchPostalCode(
  postalCode: string,
  provinces: readonly ProvinceCode[] = LAUNCH_PROVINCES,
): boolean {
  return isLaunchProvince(postalCodeProvince(postalCode), provinces);
}
