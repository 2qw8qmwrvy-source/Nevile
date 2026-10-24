/**
 * Server feature switches, read from the environment once and passed to procedures on
 * the request context (`ctx.config`), so tests inject their own.
 */
export interface ApiConfig {
  /**
   * Nevile Neighbours (SPEC §15), `NEVILE_NEIGHBOURS_ENABLED`. Off by default: until the
   * owner decides who legally holds donated money, referrals are not accepted.
   */
  readonly neighboursEnabled: boolean;
  /** Public origin of the website, for links in emails and payment pages. */
  readonly siteUrl: string;
  /** Where Nevile staff are told about escalated problems (`NEVILE_OPS_EMAIL`), if set. */
  readonly opsEmail: string | null;
  /** Stripe's publishable key for the app's payment sheet (`STRIPE_PUBLISHABLE_KEY`). */
  readonly stripePublishableKey: string | null;
}

export const DEFAULT_API_CONFIG: ApiConfig = Object.freeze({
  neighboursEnabled: false,
  siteUrl: "http://localhost:3000",
  opsEmail: null,
  stripePublishableKey: null,
});

type Env = Readonly<Record<string, string | undefined>>;

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off"]);

/** A boolean environment variable; empty or unset gives `fallback`, anything unclear throws. */
export function parseBooleanEnv(
  name: string,
  value: string | undefined,
  fallback: boolean,
): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  throw new Error(`${name} must be "true" or "false", got "${value}".`);
}

export function readApiConfig(env: Env = process.env): ApiConfig {
  const siteUrl = (env.NEXT_PUBLIC_SITE_URL || env.BETTER_AUTH_URL || DEFAULT_API_CONFIG.siteUrl)
    .trim()
    .replace(/\/+$/, "");
  return Object.freeze({
    neighboursEnabled: parseBooleanEnv(
      "NEVILE_NEIGHBOURS_ENABLED",
      env.NEVILE_NEIGHBOURS_ENABLED,
      DEFAULT_API_CONFIG.neighboursEnabled,
    ),
    siteUrl,
    opsEmail: env.NEVILE_OPS_EMAIL?.trim() || null,
    stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY?.trim() || null,
  });
}

let cached: ApiConfig | undefined;

/** The process-wide configuration, read from `process.env` on first use. */
export function getApiConfig(): ApiConfig {
  cached ??= readApiConfig();
  return cached;
}
