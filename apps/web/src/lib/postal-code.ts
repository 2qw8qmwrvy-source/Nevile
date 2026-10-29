import { launchPostalCodeSchema } from "@nevile/core";

/**
 * Client-side check of a sign-up postal code: a hint only, the server decides. Returns an
 * error message, or null when the code is a valid Nova Scotia postal code. Kept apart from
 * the auth client, which every page loads, so the validation library loads only here.
 */
export function postalCodeError(value: string): string | null {
  if (!value.trim()) return "Enter your postal code.";
  const result = launchPostalCodeSchema.safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? "Enter a valid postal code.");
}
