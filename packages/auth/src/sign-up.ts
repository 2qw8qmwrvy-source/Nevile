import { timingSafeEqual } from "node:crypto";
import {
  isLaunchPostalCode,
  MARKETING_CONSENT_VERSION,
  normalizePostalCode,
  OUTSIDE_LAUNCH_REGION_MESSAGE,
  POSTAL_CODE_INVALID_MESSAGE,
} from "@nevile/core";
import { auditLog, type Database, profiles } from "@nevile/db";
import { APIError } from "better-auth/api";

/**
 * Sign-up rules shared by every way an account can be created (SPEC §1, §2, §17): a
 * Nova Scotia postal code is required and checked here on the server, and the optional
 * marketing consent is recorded with its wording version.
 */

/** The only Better Auth endpoints that may create a user. Every other path is refused. */
export const USER_CREATING_PATHS: readonly string[] = ["/sign-up/email", "/phone-number/verify"];

/** `code` values of the 400 responses for the sign-up fields. */
export const SIGN_UP_ERROR_CODES = {
  POSTAL_CODE_REQUIRED: "POSTAL_CODE_REQUIRED",
  INVALID_POSTAL_CODE: "INVALID_POSTAL_CODE",
  NOT_IN_SERVICE_AREA: "NOT_IN_SERVICE_AREA",
  INVALID_MARKETING_CONSENT: "INVALID_MARKETING_CONSENT",
  SIGN_UP_NOT_ALLOWED: "SIGN_UP_NOT_ALLOWED",
} as const;

export const POSTAL_CODE_REQUIRED_MESSAGE = "Enter your postal code to create your account.";

/** Audit-log actions for CASL consent changes; the profile holds only the current state. */
export const MARKETING_CONSENT_AUDIT_ACTIONS = {
  granted: "marketing_consent.granted",
  withdrawn: "marketing_consent.withdrawn",
} as const;

/** Longer input is never a postal code; checked before any normalising work. */
const POSTAL_CODE_MAX_INPUT_LENGTH = 16;

export interface SignUpDetails {
  /** Canonical "A1A 1A1", inside the launch provinces. */
  postalCode: string;
  marketingConsent: boolean;
}

function badRequest(code: string, message: string): APIError {
  return new APIError("BAD_REQUEST", { code, message });
}

/** A sign-up postal code: present, valid and in a launch province, else a 400. */
export function parseSignUpPostalCode(value: unknown): string {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
    throw badRequest(SIGN_UP_ERROR_CODES.POSTAL_CODE_REQUIRED, POSTAL_CODE_REQUIRED_MESSAGE);
  }
  const normalized =
    typeof value === "string" && value.length <= POSTAL_CODE_MAX_INPUT_LENGTH
      ? normalizePostalCode(value)
      : null;
  if (!normalized) {
    throw badRequest(SIGN_UP_ERROR_CODES.INVALID_POSTAL_CODE, POSTAL_CODE_INVALID_MESSAGE);
  }
  if (!isLaunchPostalCode(normalized)) {
    throw badRequest(SIGN_UP_ERROR_CODES.NOT_IN_SERVICE_AREA, OUTSIDE_LAUNCH_REGION_MESSAGE);
  }
  return normalized;
}

/** The optional, unticked-by-default consent box: absent means no consent. */
export function parseMarketingConsent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") {
    throw badRequest(
      SIGN_UP_ERROR_CODES.INVALID_MARKETING_CONSENT,
      "marketingConsent must be true or false",
    );
  }
  return value;
}

/** Validates Nevile's sign-up fields in a request body; throws a 400 `APIError`. */
export function signUpDetailsFrom(body: Record<string, unknown> | undefined): SignUpDetails {
  return {
    postalCode: parseSignUpPostalCode(body?.postalCode),
    marketingConsent: parseMarketingConsent(body?.marketingConsent),
  };
}

/** Constant-time string comparison (lengths are not secret). */
export function sameCode(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Creates the new user's profile with their sign-up postal code and, when they ticked the
 * box, their marketing consent (timestamp + wording version, plus an audit entry).
 */
export async function createSignUpProfile(
  db: Database,
  newUser: { id: string; name: string },
  details: SignUpDetails,
  at: Date = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const consent = details.marketingConsent
      ? { marketingConsentAt: at, marketingConsentVersion: MARKETING_CONSENT_VERSION }
      : {};
    const [created] = await tx
      .insert(profiles)
      .values({
        userId: newUser.id,
        displayName: newUser.name,
        postalCode: details.postalCode,
        ...consent,
      })
      .onConflictDoNothing({ target: profiles.userId })
      .returning({ id: profiles.id });
    if (created && details.marketingConsent) {
      await tx.insert(auditLog).values({
        actorUserId: newUser.id,
        action: MARKETING_CONSENT_AUDIT_ACTIONS.granted,
        entity: "user",
        entityId: newUser.id,
        data: { version: MARKETING_CONSENT_VERSION, source: "sign_up" },
        createdAt: at,
      });
    }
  });
}
