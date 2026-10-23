import { sql } from "drizzle-orm";
import { check, index, pgTable, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { businesses, businessMembers } from "./businesses.ts";
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
    // One span per weekday (SPEC §19).
    uniqueIndex("availability_rules_member_weekday_uidx").on(t.memberId, t.weekday),
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

/**
 * A business's arrival windows (SPEC §19), in minutes from local midnight. A business
 * without rows uses the default windows. Overlaps are refused by the API.
 */
export const arrivalWindows = pgTable(
  "arrival_windows",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    startMinute: smallint("start_minute").notNull(),
    endMinute: smallint("end_minute").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("arrival_windows_business_start_uidx").on(t.businessId, t.startMinute),
    check(
      "arrival_windows_range",
      sql`${t.startMinute} >= 360 AND ${t.endMinute} <= 1260 AND ${t.endMinute} - ${t.startMinute} BETWEEN 60 AND 360`,
    ),
    check("arrival_windows_step", sql`${t.startMinute} % 15 = 0 AND ${t.endMinute} % 15 = 0`),
  ],
);
