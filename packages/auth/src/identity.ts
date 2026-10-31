import { normalizeCanadianPhone } from "@nevile/core";

/**
 * Accounts created by phone sign-in get a placeholder email, because Better Auth needs
 * one per user. `.invalid` is reserved (RFC 2606), so these never deliver, and email
 * sign-up rejects the domain so nobody can pre-register a number's placeholder.
 */
export const PHONE_PLACEHOLDER_EMAIL_DOMAIN = "phone.nevile.invalid";

export function placeholderEmailForPhone(phoneNumber: string): string {
  return `${phoneNumber.replace(/\D/g, "")}@${PHONE_PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return (
    typeof email === "string" &&
    email.trim().toLowerCase().endsWith(`@${PHONE_PLACEHOLDER_EMAIL_DOMAIN}`)
  );
}

/** The user's real email, or null for phone-only accounts. */
export function contactEmail(email: string | null | undefined): string | null {
  return email && !isPlaceholderEmail(email) ? email : null;
}

/**
 * Phone numbers must reach the auth API already normalized to E.164 (`+1XXXXXXXXXX`;
 * clients use `normalizeCanadianPhone` from @nevile/core), so one number can never
 * map to two accounts through different spellings.
 */
export function isNormalizedCanadianPhone(phoneNumber: string): boolean {
  return normalizeCanadianPhone(phoneNumber) === phoneNumber;
}

export type VerificationMethod = "email" | "phone";

/** The contact fields of a Better Auth user (session user or row). */
export interface ContactFields {
  email?: string | null;
  emailVerified?: boolean | null;
  phoneNumber?: string | null;
  phoneNumberVerified?: boolean | null;
}

/**
 * How the user proved a contact (SPEC §1 verification gate): a confirmed real email
 * address first, else a phone number verified by SMS code, else null (unverified).
 */
export function verificationMethodOf(user: ContactFields): VerificationMethod | null {
  if (contactEmail(user.email) && user.emailVerified === true) return "email";
  if (user.phoneNumber && user.phoneNumberVerified === true) return "phone";
  return null;
}

/** Whether the user may book, pay, message or use business tools. */
export function hasVerifiedContact(user: ContactFields): boolean {
  return verificationMethodOf(user) !== null;
}
