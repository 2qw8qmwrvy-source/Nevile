/**
 * Canadian phone numbers and postal codes as plain functions, with no validation library:
 * the sign-in client on every web page uses them, so they stay small. The Zod schemas built
 * on them are in `schemas.ts`.
 */

const PHONE_FORMATTING = /[\s().\-‐-―]/g;
const NANP_SUBSCRIBER = /^([2-9]\d{2})([2-9]\d{2})(\d{4})$/;

/**
 * Geographic area codes assigned to Canada by the Canadian Numbering Administrator,
 * including overlays announced for 2024–2025 (257, 474, 584, 753, 942). SPEC §2 limits the
 * launch market to Canada, and SMS codes go only to these numbers: other +1 countries
 * (Jamaica 876, Dominican Republic 809, BVI 284…), US numbers, and non-geographic or
 * premium codes (600, 800-series, 900, 976) are refused, which keeps SMS pumping off
 * high-cost routes. Update this list when the CRTC introduces a new overlay
 * (https://www.cnac.ca/area_code_maps/canadian_area_codes.htm).
 */
// biome-ignore format: one line per province keeps the list reviewable.
export const CANADIAN_AREA_CODES: ReadonlySet<string> = new Set([
  // Alberta
  "368", "403", "587", "780", "825",
  // British Columbia
  "236", "250", "257", "604", "672", "778",
  // Manitoba
  "204", "431", "584",
  // New Brunswick
  "428", "506",
  // Newfoundland and Labrador
  "709", "879",
  // Nova Scotia and Prince Edward Island
  "782", "902",
  // Ontario
  "226", "249", "289", "343", "365", "382", "416", "437", "519", "548", "613", "647",
  "683", "705", "742", "753", "807", "905", "942",
  // Quebec
  "263", "354", "367", "418", "438", "450", "468", "514", "579", "581", "819", "873",
  // Saskatchewan
  "306", "474", "639",
  // Yukon, Northwest Territories and Nunavut
  "867",
]);

/**
 * Normalizes a Canadian phone number to E.164 ("+14165551234"), or returns null.
 * Accepts common layouts ("(416) 555-1234", "416.555.1234", "1 416 555 1234",
 * "+1-416-555-1234"). The number must follow NANP rules (no N11 exchanges) and use a
 * Canadian area code (`CANADIAN_AREA_CODES`).
 */
export function normalizeCanadianPhone(input: string): string | null {
  let value = input.trim().replace(PHONE_FORMATTING, "");
  if (value.startsWith("+")) {
    if (!value.startsWith("+1")) return null;
    value = value.slice(2);
  } else if (value.length === 11 && value.startsWith("1")) {
    value = value.slice(1);
  }
  const match = NANP_SUBSCRIBER.exec(value);
  if (!match) return null;
  const [, area = "", exchange = ""] = match;
  if (!CANADIAN_AREA_CODES.has(area) || exchange.endsWith("11")) return null;
  return `+1${value}`;
}

/** Canadian postal codes never use D, F, I, O, Q or U, and never start with W or Z. */
const POSTAL_CODE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/;

/** Normalizes a Canadian postal code to "A1A 1A1", or returns null. */
export function normalizePostalCode(input: string): string | null {
  const compact = input.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!POSTAL_CODE.test(compact)) return null;
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

export const POSTAL_CODE_INVALID_MESSAGE = "Enter a valid Canadian postal code (e.g. A1A 1A1)";

/** "b3h 1a1" → "B3H"; null for anything that isn't a Canadian postal code or area. */
export function postalAreaOf(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/\s+/g, "");
  // Forward sortation area: Canada Post never uses D, F, I, O, Q or U, nor W/Z first.
  if (/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]$/.test(compact)) return compact;
  const normalized = normalizePostalCode(value);
  return normalized ? normalized.slice(0, 3) : null;
}
