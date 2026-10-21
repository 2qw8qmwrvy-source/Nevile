import { sql } from "drizzle-orm";
import { check, integer, type PgColumn, timestamp, uuid } from "drizzle-orm/pg-core";

/** Default IANA zone for jobs whose local-day logic has no better source (CLAUDE.md). */
export const DEFAULT_TIMEZONE = "America/Toronto";

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

/** Lowercase kebab-case, e.g. `snow-ice-removal`. */
export const slugCheck = (table: string, column: PgColumn) =>
  check(`${table}_${column.name}_format`, sql`${column} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`);
