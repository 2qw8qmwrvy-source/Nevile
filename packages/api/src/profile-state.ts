import { MARKETING_CONSENT_VERSION, type OnboardingIntent } from "@nevile/core";
import { type DbExecutor, profiles } from "@nevile/db";

/** The onboarding columns of a profile row. */
export interface OnboardingColumns {
  onboardingIntent: OnboardingIntent | null;
  postalCode: string | null;
  interests: string[];
  onboardedAt: Date | null;
}

export interface OnboardingState {
  intent: OnboardingIntent | null;
  /** Sign-up or welcome postal code, canonical "A1A 1A1". */
  postalCode: string | null;
  /** Service category slugs, for the personalised homepage. */
  interests: string[];
  /** The optional welcome was finished or skipped (SPEC §16); false shows it again. */
  completed: boolean;
}

export function onboardingState(row: OnboardingColumns | null | undefined): OnboardingState {
  return {
    intent: row?.onboardingIntent ?? null,
    postalCode: row?.postalCode ?? null,
    interests: row?.interests ?? [],
    completed: row?.onboardedAt != null,
  };
}

/** The consent columns of a profile row. */
export interface ConsentColumns {
  marketingConsentAt: Date | null;
  marketingConsentVersion: string | null;
}

export interface MarketingConsentState {
  consented: boolean;
  /** Wording version the user agreed to; null when they have not consented. */
  version: string | null;
  at: Date | null;
  /** True when they agreed to older wording than `MARKETING_CONSENT_VERSION`. */
  outdated: boolean;
}

export function marketingConsentState(
  row: ConsentColumns | null | undefined,
): MarketingConsentState {
  const at = row?.marketingConsentAt ?? null;
  const version = at ? (row?.marketingConsentVersion ?? null) : null;
  return {
    consented: at !== null,
    version,
    at,
    outdated: at !== null && version !== MARKETING_CONSENT_VERSION,
  };
}

/**
 * Makes sure the user has a profile row (normally created at sign-up, but that step is
 * best-effort) without changing an existing one.
 */
export async function ensureProfile(
  db: DbExecutor,
  user: { id: string; name: string },
): Promise<void> {
  await db
    .insert(profiles)
    .values({ userId: user.id, displayName: user.name })
    .onConflictDoNothing({ target: profiles.userId });
}
