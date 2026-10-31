/** Launch region input check (SPEC §2); the rules themselves are in `launch-region.ts`. */
import { z } from "zod";
import { normalizePostalCode, POSTAL_CODE_INVALID_MESSAGE } from "./contact-formats.ts";
import { isLaunchPostalCode, OUTSIDE_LAUNCH_REGION_MESSAGE } from "./launch-region.ts";

/**
 * A postal code inside the launch region, normalized to "A1A 1A1". Reports exactly one
 * issue: an invalid code gets the format message, a valid code elsewhere in Canada gets
 * `OUTSIDE_LAUNCH_REGION_MESSAGE`.
 */
export const launchPostalCodeSchema = z.string().transform((value, ctx) => {
  const normalized = normalizePostalCode(value);
  if (!normalized) {
    ctx.addIssue({ code: "custom", message: POSTAL_CODE_INVALID_MESSAGE });
    return z.NEVER;
  }
  if (!isLaunchPostalCode(normalized)) {
    ctx.addIssue({ code: "custom", message: OUTSIDE_LAUNCH_REGION_MESSAGE });
    return z.NEVER;
  }
  return normalized;
});
