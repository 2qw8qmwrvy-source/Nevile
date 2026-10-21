import { account, rateLimit, session, user, verification } from "./schema/auth.ts";

export {
  closeDb,
  type CreateDbOptions,
  createDb,
  type Database,
  type DbExecutor,
  db,
  getDb,
  type Schema,
} from "./client.ts";
export * as schema from "./schema/index.ts";
export * from "./schema/index.ts";
export type * from "./types.ts";

/**
 * Tables for Better Auth's drizzle adapter:
 * `drizzleAdapter(db, { provider: "pg", schema: authSchema, usePlural: false })`.
 */
export const authSchema = { user, session, account, verification, rateLimit };

// Query helpers re-exported so consumers need no direct drizzle-orm dependency.
export {
  and,
  asc,
  avg,
  between,
  count,
  desc,
  eq,
  exists,
  getTableColumns,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  max,
  min,
  ne,
  not,
  notExists,
  notInArray,
  or,
  type SQL,
  sql,
  sum,
} from "drizzle-orm";
