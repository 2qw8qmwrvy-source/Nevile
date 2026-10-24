import { z } from "zod";

const booleanFlag = z.enum(["true", "false", "1", "0", ""]).optional();
const optionalUrl = z.union([z.literal(""), z.url()]).optional();

/**
 * Server settings checked once at start-up (SPEC §17): a misconfigured production server
 * refuses to start with a clear list of problems instead of failing on the first request.
 * Build steps don't run this, so CI can build with placeholder values.
 */
const productionSchema = z.object({
  DATABASE_URL: z.url({ message: "must be a postgresql:// connection URL" }),
  BETTER_AUTH_SECRET: z
    .string({ message: "is required" })
    .min(32, { message: "must be at least 32 characters (openssl rand -base64 32)" }),
  BETTER_AUTH_URL: z.url({ message: "must be the public https:// origin of the site" }),
  NEXT_PUBLIC_SITE_URL: z.url({ message: "must be the public https:// origin of the site" }),
  NEVILE_NEIGHBOURS_ENABLED: booleanFlag,
  SENTRY_DSN: optionalUrl,
  NEXT_PUBLIC_SENTRY_DSN: optionalUrl,
  // Business photos (SPEC §18): an S3-compatible bucket in production.
  MEDIA_STORAGE: z.enum(["s3", ""], { message: 'must be "s3" in production' }).optional(),
  S3_BUCKET: z.string({ message: "is required (media bucket name)" }).min(1),
  S3_ACCESS_KEY_ID: z.string({ message: "is required" }).min(1),
  S3_SECRET_ACCESS_KEY: z.string({ message: "is required" }).min(1),
  S3_ENDPOINT: optionalUrl,
  MEDIA_PUBLIC_BASE_URL: optionalUrl,
  // Bookings and payments (SPEC §19): Stripe in production.
  PAYMENTS_PROVIDER: z
    .enum(["stripe", ""], { message: 'must be "stripe" in production' })
    .optional(),
  STRIPE_SECRET_KEY: z
    .string({ message: "is required (Stripe secret key)" })
    .regex(/^(sk|rk)_(live|test)_/, { message: "must be a Stripe secret key (sk_live_…)" }),
  STRIPE_WEBHOOK_SECRET: z
    .string({ message: "is required (Stripe webhook signing secret)" })
    .startsWith("whsec_", { message: "must be a webhook signing secret (whsec_…)" }),
  STRIPE_CONNECT_WEBHOOK_SECRET: z
    .union([z.literal(""), z.string().startsWith("whsec_", { message: "must start with whsec_" })])
    .optional(),
  // The app's payment sheet (SPEC §20).
  STRIPE_PUBLISHABLE_KEY: z
    .string({ message: "is required (Stripe publishable key, for the app)" })
    .regex(/^pk_(live|test)_/, { message: "must be a Stripe publishable key (pk_live_…)" }),
  NEVILE_ALLOW_TEST_PAYMENTS: booleanFlag,
  // Optional: Expo push security (an access token from your Expo account).
  EXPO_ACCESS_TOKEN: z.string().optional(),
  // Scheduled jobs (/api/cron) are refused without it.
  CRON_SECRET: z
    .string({ message: "is required (openssl rand -base64 32)" })
    .min(32, { message: "must be at least 32 characters (openssl rand -base64 32)" }),
  NEVILE_OPS_EMAIL: z
    .union([z.literal(""), z.email({ message: "must be an email address" })])
    .optional(),
});

/** Same shape outside production, but only formats are checked; missing values are fine. */
const developmentSchema = productionSchema.partial().extend({
  DATABASE_URL: z.url().optional(),
  BETTER_AUTH_SECRET: z.string().optional(),
  BETTER_AUTH_URL: z.url().optional(),
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
  MEDIA_STORAGE: z.enum(["local", "s3", ""]).optional(),
  PAYMENTS_PROVIDER: z.enum(["fake", "stripe", ""]).optional(),
});

export type EnvProblem = { name: string; message: string };

export function findEnvProblems(env: NodeJS.ProcessEnv = process.env): EnvProblem[] {
  const production = env.NODE_ENV === "production";
  const schema = production ? productionSchema : developmentSchema;
  // Outside production an empty value (KEY= copied from .env.example) means "not set".
  const values = production
    ? env
    : Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
  const result = schema.safeParse(values);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    name: String(issue.path[0] ?? "environment"),
    message: issue.message,
  }));
}

/** Throws in production, warns elsewhere. Never prints values, only variable names. */
export function assertValidEnv(env: NodeJS.ProcessEnv = process.env): void {
  const problems = findEnvProblems(env);
  if (problems.length === 0) return;
  const report = problems.map((problem) => `  - ${problem.name} ${problem.message}`).join("\n");
  if (env.NODE_ENV === "production") {
    throw new Error(`Nevile can't start: fix these settings (see .env.example):\n${report}`);
  }
  console.warn(`[env] Some settings look wrong (see .env.example):\n${report}`);
}
