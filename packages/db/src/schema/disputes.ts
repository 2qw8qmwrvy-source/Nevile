import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { visits } from "./bookings.ts";
import { cents, id, nonNegative, timestamps, tstz } from "./columns.ts";
import { disputeResolution, disputeStatus } from "./enums.ts";

/**
 * Problem reported within the 48h confirmation window (SPEC §6). Payment stays held;
 * the business has until `fix_deadline` (3 days) to return, then an admin decides.
 */
export const disputes = pgTable(
  "disputes",
  {
    id: id(),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "restrict" }),
    openedByUserId: text("opened_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    status: disputeStatus("status").notNull().default("open"),
    fixDeadline: tstz("fix_deadline").notNull(),
    // Return visit booked to fix the problem.
    fixVisitId: uuid("fix_visit_id").references(() => visits.id, { onDelete: "set null" }),
    escalatedAt: tstz("escalated_at"),
    resolution: disputeResolution("resolution"),
    // Amount refunded to the customer by the resolution, in cents.
    refundCents: cents("refund_cents"),
    resolutionNote: text("resolution_note"),
    resolvedByUserId: text("resolved_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    resolvedAt: tstz("resolved_at"),
    ...timestamps(),
  },
  (t) => [
    index("disputes_visit_id_idx").on(t.visitId),
    index("disputes_status_fix_deadline_idx").on(t.status, t.fixDeadline),
    uniqueIndex("disputes_one_active_per_visit_uidx")
      .on(t.visitId)
      .where(sql`${t.status} <> 'resolved'`),
    nonNegative("disputes", t.refundCents),
    check(
      "disputes_resolved_fields",
      sql`(${t.status} = 'resolved') = (${t.resolution} IS NOT NULL AND ${t.resolvedAt} IS NOT NULL)`,
    ),
    check(
      "disputes_partial_refund_amount",
      sql`${t.resolution} IS DISTINCT FROM 'partial_refund' OR ${t.refundCents} > 0`,
    ),
    check(
      "disputes_escalated_fields",
      sql`${t.status} <> 'escalated' OR ${t.escalatedAt} IS NOT NULL`,
    ),
  ],
);
