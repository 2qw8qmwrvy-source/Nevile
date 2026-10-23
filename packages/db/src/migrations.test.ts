import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER, runMigrations } from "./migrate.ts";
import { emptyTestDatabase } from "./testing.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

interface Journal {
  entries: { idx: number; tag: string; when: number }[];
}

const journal = JSON.parse(
  readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
) as Journal;

/** The last migration before SPEC v1.1 (community program, onboarding). */
const PRE_V11_TAG = "0004_money_and_slot_guards";

const V11_TABLES = [
  "community_fund_ledger",
  "community_partner_members",
  "community_partners",
  "community_referrals",
  "donations",
];

/** A copy of the migrations folder whose journal stops at `lastTag`. */
function migrationsThrough(lastTag: string): string {
  const cut = journal.entries.findIndex((entry) => entry.tag === lastTag);
  if (cut < 0) throw new Error(`migration ${lastTag} is not in the journal`);
  const entries = journal.entries.slice(0, cut + 1);
  const folder = mkdtempSync(join(tmpdir(), "nevile-migrations-"));
  cpSync(join(MIGRATIONS_FOLDER, "meta"), join(folder, "meta"), { recursive: true });
  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const entry of entries) {
    cpSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  return folder;
}

describe.skipIf(!TEST_DATABASE_URL)("migrations", () => {
  const url = TEST_DATABASE_URL as string;
  let client: pg.Client;
  const folders: string[] = [];

  const rows = async <T>(text: string, values: unknown[] = []) =>
    (await client.query(text, values)).rows as T[];

  const publicTables = async () =>
    (
      await rows<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      )
    ).map((row) => row.table_name);

  beforeEach(async () => {
    await emptyTestDatabase(url);
    client = new pg.Client({ connectionString: url });
    await client.connect();
  });

  afterEach(async () => {
    await client.end();
  });

  afterAll(async () => {
    for (const folder of folders) rmSync(folder, { recursive: true, force: true });
    // Leave the shared test database fully migrated for the other test files.
    await runMigrations(url);
  });

  it("applies every migration to an empty database", async () => {
    await runMigrations(url);
    const applied = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
    );
    expect(applied[0]?.count).toBe(journal.entries.length);
    expect(await publicTables()).toEqual(expect.arrayContaining(V11_TABLES));
    const triggers = await rows<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = 'community_fund_ledger'::regclass AND NOT tgisinternal`,
    );
    expect(triggers.map((row) => row.tgname).sort()).toEqual([
      "community_fund_ledger_check_entry",
      "community_fund_ledger_no_truncate",
      "community_fund_ledger_no_update_delete",
    ]);
    // Re-running is a no-op.
    await runMigrations(url);
    const again = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
    );
    expect(again[0]?.count).toBe(journal.entries.length);
  });

  it("upgrades a pre-v1.1 database without losing its data", async () => {
    const folder = migrationsThrough(PRE_V11_TAG);
    folders.push(folder);
    await runMigrations(url, folder);
    expect(await publicTables()).not.toContain("donations");

    // Data written by the v1.0 schema: a user with a profile and a business.
    await client.query(
      `INSERT INTO "user" (id, name, email) VALUES ('legacy-user', 'Lee Legacy', 'lee@example.com')`,
    );
    await client.query(
      `INSERT INTO profiles (user_id, display_name, active_mode) VALUES ('legacy-user', 'Lee Legacy', 'business')`,
    );
    await client.query(
      `INSERT INTO businesses (owner_user_id, name, slug, province)
       VALUES ('legacy-user', 'Legacy Lawns', 'legacy-lawns', 'ON')`,
    );

    await runMigrations(url);

    const applied = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
    );
    expect(applied[0]?.count).toBe(journal.entries.length);
    expect(await publicTables()).toEqual(expect.arrayContaining(V11_TABLES));

    const [profile] = await rows<Record<string, unknown>>(
      `SELECT display_name, active_mode, postal_code, onboarding_intent, interests, onboarded_at,
              marketing_consent_at, marketing_consent_version
       FROM profiles WHERE user_id = 'legacy-user'`,
    );
    expect(profile).toEqual({
      display_name: "Lee Legacy",
      active_mode: "business",
      postal_code: null,
      onboarding_intent: null,
      interests: [],
      onboarded_at: null,
      marketing_consent_at: null,
      marketing_consent_version: null,
    });

    // Existing rows keep their zone; new rows default to Atlantic time (SPEC §2).
    await client.query(
      `INSERT INTO businesses (owner_user_id, name, slug, province)
       VALUES ('legacy-user', 'New Lawns', 'new-lawns', 'NS')`,
    );
    const zones = await rows<{ slug: string; timezone: string }>(
      "SELECT slug, timezone FROM businesses ORDER BY slug",
    );
    expect(zones).toEqual([
      { slug: "legacy-lawns", timezone: "America/Toronto" },
      { slug: "new-lawns", timezone: "America/Halifax" },
    ]);

    // The upgraded profile accepts the v1.1 onboarding fields.
    await client.query(
      `UPDATE profiles SET postal_code = 'B3H 1A1', onboarding_intent = 'both',
         interests = ARRAY['lawn-mowing', 'snow-ice-removal'], onboarded_at = now()
       WHERE user_id = 'legacy-user'`,
    );
  });
});
