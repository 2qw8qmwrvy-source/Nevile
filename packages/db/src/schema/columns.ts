import type { DEFAULT_TIME_ZONE } from "@nevile/core";
import { sql } from "drizzle-orm";
import { check, integer, type PgColumn, timestamp, uuid } from "drizzle-orm/pg-core";

/** Default IANA zone for jobs whose local-day logic has no better source (SPEC §2). */
export const DEFAULT_TIMEZONE: typeof DEFAULT_TIME_ZONE = "America/Halifax";

/**
 * Canadian postal code in canonical form `A1A 1A1` (uppercase, single space).
 * D, F, I, O, Q, U never appear; W and Z never lead. Any province: which provinces are
 * open for sign-up is application configuration, not a database rule (SPEC §2).
 */
export const POSTAL_CODE_PATTERN =
  "^[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z] [0-9][ABCEGHJ-NPRSTV-Z][0-9]$";

export const id = () => uuid("id").primaryKey().defaultRandom();

/** Every timestamp is timestamptz, read and written as a JS `Date` (UTC instant). */
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const createdAt = () => tstz("created_at").notNull().defaultNow();

export const updatedAt = () =>
  tstz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });

/** Money is integer cents (CAD). Pair with `nonNegative` / `positive` checks. */
export const cents = (name: string) => integer(name);

export const nonNegative = (table: string, column: PgColumn) =>
  check(`${table}_${column.name}_non_negative`, sql`${column} >= 0`);

export const positive = (table: string, column: PgColumn) =>
  check(`${table}_${column.name}_positive`, sql`${column} > 0`);

export const latitudeCheck = (table: string, column: PgColumn) =>
  check(`${table}_${column.name}_range`, sql`${column} BETWEEN -90 AND 90`);

export const longitudeCheck = (table: string, column: PgColumn) =>
  check(`${table}_${column.name}_range`, sql`${column} BETWEEN -180 AND 180`);

/** One lowercase kebab-case slug, e.g. `snow-ice-removal` (unanchored). */
const SLUG_BODY = "[a-z0-9]+(-[a-z0-9]+)*";
const SLUG_PATTERN = `^${SLUG_BODY}$`;

export const slugCheck = (table: string, column: PgColumn) =>
  check(`${table}_${column.name}_format`, sql`${column} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`);

/**
 * A one-dimensional `text[]` of at most `maxLength` slugs. The array's text form is
 * `{slug,slug,...}` exactly when no element is NULL, empty or needs quoting.
 */
export const slugArrayCheck = (table: string, column: PgColumn, maxLength: number) =>
  check(
    `${table}_${column.name}_format`,
    sql`cardinality(${column}) <= ${sql.raw(String(maxLength))} AND ${column}::text ~ ${sql.raw(`'^[{](${SLUG_BODY}(,${SLUG_BODY})*)?[}]$'`)}`,
  );

export const postalCodeCheck = (table: string, column: PgColumn) =>
  check(`${table}_${column.name}_format`, sql`${column} ~ ${sql.raw(`'${POSTAL_CODE_PATTERN}'`)}`);
