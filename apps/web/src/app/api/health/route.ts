import { getDb, sql } from "@nevile/db";

// Uptime checks hit this often: never cache, never render.
export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 2000;

/**
 * Health check for uptime monitors (SPEC §17): 200 when the app and its database answer,
 * 503 otherwise. Reports nothing secret: no error messages, hosts or settings.
 */
export async function GET() {
  let database: "ok" | "error" = "error";
  try {
    await Promise.race([
      getDb().execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS)),
    ]);
    database = "ok";
  } catch {
    database = "error";
  }
  const healthy = database === "ok";
  return Response.json(
    {
      status: healthy ? "ok" : "error",
      version: process.env.APP_VERSION || "dev",
      db: database,
    },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
