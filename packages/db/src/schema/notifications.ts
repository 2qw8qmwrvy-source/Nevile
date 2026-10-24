import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { createdAt, id, tstz, updatedAt } from "./columns.ts";
import { pushPlatform } from "./enums.ts";

/** In-app notification inbox (SPEC §10). `type` is an open set, e.g. `booking.confirmed`. */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    readAt: tstz("read_at"),
    // When it was sent to the person's phones (SPEC §20); null until pushed.
    pushedAt: tstz("pushed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("notifications_user_unread_idx").on(t.userId).where(sql`${t.readAt} IS NULL`),
    index("notifications_unpushed_idx").on(t.createdAt).where(sql`${t.pushedAt} IS NULL`),
  ],
);

/** Device / browser push registrations (Expo push tokens, Web Push endpoints). */
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    platform: pushPlatform("platform").notNull(),
    token: text("token").notNull().unique(),
    lastSeenAt: tstz("last_seen_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("push_tokens_user_id_idx").on(t.userId)],
);
