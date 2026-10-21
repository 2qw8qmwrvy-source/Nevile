import { sql } from "drizzle-orm";
import { check, index, pgTable, smallint, text, uuid } from "drizzle-orm/pg-core";
import { businessMembers } from "./businesses.ts";
import { id, timestamps, tstz } from "./columns.ts";

/**
 * Weekly working hours per crew member, in minutes from local midnight of the
 * business's timezone. Weekday: 0 = Sunday … 6 = Saturday (JS `getDay()`).
 */
export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: id(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => businessMembers.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(),
    startMinute: smallint("start_minute").notNull(),
    endMinute: smallint("end_minute").notNull(),
    ...timestamps(),
  },
  (t) => [
    index("availability_rules_member_weekday_idx").on(t.memberId, t.weekday),
    check("availability_rules_weekday_range", sql`${t.weekday} BETWEEN 0 AND 6`),
    check(
      "availability_rules_minutes_range",
      sql`${t.startMinute} >= 0 AND ${t.endMinute} <= 1440 AND ${t.startMinute} < ${t.endMinute}`,
    ),
  ],
);

/** Blocked time (days off) for a crew member. */
export const timeOff = pgTable(
  "time_off",
  {
    id: id(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => businessMembers.id, { onDelete: "cascade" }),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    reason: text("reason"),
    ...timestamps(),
  },
  (t) => [
    index("time_off_member_starts_idx").on(t.memberId, t.startsAt),
    check("time_off_range", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);
