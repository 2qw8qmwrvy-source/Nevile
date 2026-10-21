import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns.ts";

/**
 * Append-only audit trail for money movements and admin actions (SPEC §12).
 * A trigger (custom migration) rejects UPDATE, DELETE and TRUNCATE.
 * `actor_user_id` deliberately has no foreign key so history outlives accounts;
 * null means the system (cron jobs, Stripe webhooks).
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: text("ip_address"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entity, t.entityId, t.createdAt),
    index("audit_log_actor_created_idx").on(t.actorUserId, t.createdAt),
    index("audit_log_created_at_idx").on(t.createdAt),
  ],
);
