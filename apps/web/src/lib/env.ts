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
});

/** Same shape outside production, but only formats are checked; missing values are fine. */
const developmentSchema = productionSchema.partial().extend({
  DATABASE_URL: z.url().optional(),
  BETTER_AUTH_SECRET: z.string().optional(),
  BETTER_AUTH_URL: z.url().optional(),
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
});

export type EnvProblem = { name: string; message: string };

export function findEnvProblems(env: NodeJS.ProcessEnv = process.env): EnvProblem[] {
  const schema = env.NODE_ENV === "production" ? productionSchema : developmentSchema;
  const result = schema.safeParse(env);
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
