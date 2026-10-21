import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { bookings, visits } from "./bookings.ts";
import { businesses } from "./businesses.ts";
import { createdAt, id, tstz, updatedAt } from "./columns.ts";
import { partyRole } from "./enums.ts";

/**
 * Two-sided ratings after a completed visit (SPEC §9), visible immediately.
 * - one review per side per visit;
 * - at most one review per side per booking per month of service, which makes the
 *   recurring/contract monthly cap hold (one-off bookings have a single visit anyway);
 * - the rated party may post one public reply.
 * Composite FKs keep `booking_id` the visit's booking and `business_id` the booking's
 * business, so neither the monthly cap nor a business's rating can be gamed by filing a
 * review under another booking or business.
 * Business ratings aggregate on `business_id` where `rater_role = 'customer'`;
 * customer ratings aggregate on `ratee_user_id` where `rater_role = 'business'`.
 * Deleting a user account keeps the reviews it wrote or received (the user ids become
 * null; display falls back to the business / "former customer").
 * The 14-day window is enforced by the API (it depends on the visit's confirmation time).
 */
export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    // Null once the author's account is deleted.
    raterUserId: text("rater_user_id").references(() => user.id, { onDelete: "set null" }),
    // For customer → business reviews this is the business owner's user id at the time;
    // the business itself is `business_id`. Null once that account is deleted.
    rateeUserId: text("ratee_user_id").references(() => user.id, { onDelete: "set null" }),
    raterRole: partyRole("rater_role").notNull(),
    // "YYYY-MM" month of the rated visit in the job's zone (core `ratingMonthKey`).
    serviceMonth: text("service_month").notNull(),
    stars: smallint("stars").notNull(),
    comment: text("comment"),
    reply: text("reply"),
    replyAt: tstz("reply_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "reviews_visit_booking_fk",
      columns: [t.visitId, t.bookingId],
      foreignColumns: [visits.id, visits.bookingId],
    }).onDelete("cascade"),
    foreignKey({
      name: "reviews_booking_business_fk",
      columns: [t.bookingId, t.businessId],
      foreignColumns: [bookings.id, bookings.businessId],
    }).onDelete("cascade"),
    unique("reviews_one_per_side_per_visit").on(t.visitId, t.raterRole),
    unique("reviews_one_per_side_per_month").on(t.bookingId, t.raterRole, t.serviceMonth),
    index("reviews_business_role_created_idx").on(t.businessId, t.raterRole, t.createdAt),
    index("reviews_ratee_role_created_idx").on(t.rateeUserId, t.raterRole, t.createdAt),
    index("reviews_rater_user_id_idx").on(t.raterUserId),
    check("reviews_stars_range", sql`${t.stars} BETWEEN 1 AND 5`),
    check("reviews_not_self", sql`${t.raterUserId} <> ${t.rateeUserId}`),
    check("reviews_reply_fields", sql`(${t.reply} IS NULL) = (${t.replyAt} IS NULL)`),
    check("reviews_service_month_format", sql`${t.serviceMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ],
);
