import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.ts";

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema> & { $client: pg.Pool };
/** A database handle or an open transaction — what repository functions should accept. */
export type DbExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface CreateDbOptions {
  /** Maximum pool size (default 10). */
  max?: number;
}

/** Creates a pooled Drizzle client with the full schema (relational queries enabled). */
export function createDb(url: string, options: CreateDbOptions = {}): Database {
  if (!url) {
    throw new Error("createDb: a PostgreSQL connection URL is required.");
  }
  const pool = new pg.Pool({ connectionString: url, max: options.max ?? 10 });
  return drizzle({ client: pool, schema });
}

// Cached on globalThis so dev servers with hot reload reuse one pool.
const DEFAULT_DB_KEY = Symbol.for("@nevile/db/default");
type GlobalWithDb = typeof globalThis & { [DEFAULT_DB_KEY]?: Database };

/**
 * The shared client for `process.env.DATABASE_URL`, created on first use.
 * Throws if `DATABASE_URL` is not set.
 */
export function getDb(): Database {
  const store = globalThis as GlobalWithDb;
  const existing = store[DEFAULT_DB_KEY];
  if (existing) return existing;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Export it or copy .env.example to .env before using @nevile/db.",
    );
  }
  const created = createDb(url);
  store[DEFAULT_DB_KEY] = created;
  return created;
}

/** Closes the shared client's pool (scripts, test teardown). Safe to call when unused. */
export async function closeDb(): Promise<void> {
  const store = globalThis as GlobalWithDb;
  const existing = store[DEFAULT_DB_KEY];
  if (!existing) return;
  delete store[DEFAULT_DB_KEY];
  await existing.$client.end();
}

/**
 * Lazy handle to `getDb()`: importing it never connects or reads the environment,
 * so modules (e.g. the Better Auth config) can reference `db` at load time and the
 * connection is resolved on first property access.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const real = getDb();
    const value: unknown = Reflect.get(real, prop, real);
    return typeof value === "function" && prop !== "constructor" ? value.bind(real) : value;
  },
  has(_target, prop) {
    return Reflect.has(getDb(), prop);
  },
  getPrototypeOf() {
    return Reflect.getPrototypeOf(getDb());
  },
});
