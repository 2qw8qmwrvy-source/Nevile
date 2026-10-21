import pg from "pg";
import { runMigrations } from "./migrate.ts";

/**
 * Test helper: drops every Nevile object in the database at `url` (schemas `public`
 * and `drizzle`) and re-applies all migrations. Refuses to run unless the database
 * name ends in `_test`, so it can never wipe a dev or production database.
 */
export async function resetTestDatabase(url: string): Promise<void> {
  const databaseName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `resetTestDatabase refuses to touch "${databaseName}": database name must end in "_test".`,
    );
  }
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
}
