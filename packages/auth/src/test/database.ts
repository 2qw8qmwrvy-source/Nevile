import { createDb, sql } from "@nevile/db";
import { resetTestDatabase } from "@nevile/db/testing";

/**
 * Gives this package its own copy of the test database (`nevile_test` becomes
 * `nevile_auth_test`), so `turbo run test` can run packages in parallel without one
 * package's reset wiping another's data. Falls back to the shared database when the
 * role may not create databases. The result is migrated from scratch.
 */
export async function freshTestDatabase(baseUrl: string, suffix: string): Promise<string> {
  const url = new URL(baseUrl);
  const baseName = decodeURIComponent(url.pathname.slice(1));
  const name = baseName.replace(/_test$/, `_${suffix}_test`);
  if (name !== baseName) {
    const admin = createDb(baseUrl, { max: 1 });
    try {
      const existing = await admin.execute(sql`SELECT 1 FROM pg_database WHERE datname = ${name}`);
      if (existing.rows.length === 0) {
        await admin.execute(sql`CREATE DATABASE ${sql.identifier(name)}`);
      }
      url.pathname = `/${encodeURIComponent(name)}`;
    } catch (error) {
      console.warn(`Could not create ${name}; using ${baseName} instead.`, error);
    } finally {
      await admin.$client.end();
    }
  }
  const target = url.toString();
  await resetTestDatabase(target);
  return target;
}
