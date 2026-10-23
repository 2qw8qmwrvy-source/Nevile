import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { createDb } from "./client.ts";
import { runMigrations } from "./migrate.ts";
import { seedCategories } from "./seed.ts";

/** Postgres "database does not exist". */
const INVALID_CATALOG_NAME = "3D000";

function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

async function createDatabaseIfMissing(url: string): Promise<void> {
  const probe = new pg.Client({ connectionString: url });
  try {
    await probe.connect();
    return;
  } catch (error) {
    if ((error as { code?: string }).code !== INVALID_CATALOG_NAME) throw error;
  } finally {
    await probe.end().catch(() => {});
  }
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(databaseNameOf(url))}`);
  } finally {
    await admin.end();
  }
}

/**
 * Browser-test helper: creates the database if needed, drops everything in it, then
 * migrates and seeds, so every Playwright run starts from the same state. Refuses to run
 * unless the database name ends in `_e2e`, so it can never wipe a real database.
 */
export async function resetE2eDatabase(url: string): Promise<void> {
  const name = databaseNameOf(url);
  if (!name.endsWith("_e2e")) {
    throw new Error(
      `resetE2eDatabase refuses to touch "${name}": database name must end in "_e2e".`,
    );
  }
  await createDatabaseIfMissing(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`
      DROP SCHEMA IF EXISTS drizzle CASCADE;
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
    `);
  } finally {
    await client.end();
  }
  await runMigrations(url);
  const db = createDb(url, { max: 1 });
  try {
    await seedCategories(db);
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;
  } else {
    resetE2eDatabase(url)
      .then(() => console.log(`Reset ${databaseNameOf(url)} for browser tests.`))
      .catch((error: unknown) => {
        console.error("E2E database reset failed:", error);
        process.exitCode = 1;
      });
  }
}
