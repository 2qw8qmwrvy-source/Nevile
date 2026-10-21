import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { bookings } from "./bookings.ts";
import { businesses } from "./businesses.ts";
import { createdAt, id, timestamps, tstz } from "./columns.ts";
import { partyRole } from "./enums.ts";
import { quoteRequests } from "./quotes.ts";

/**
 * Customer ↔ business chat, opened by the first quote or booking request (SPEC §10).
 * A conversation that began on a quote request keeps going once it becomes a booking,
 * so both scope columns may be set.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    customerId: text("customer_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    quoteRequestId: uuid("quote_request_id")
      .unique()
      .references(() => quoteRequests.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .unique()
      .references(() => bookings.id, { onDelete: "cascade" }),
    lastMessageAt: tstz("last_message_at"),
    customerLastReadAt: tstz("customer_last_read_at"),
    businessLastReadAt: tstz("business_last_read_at"),
    ...timestamps(),
  },
  (t) => [
    index("conversations_customer_last_message_idx").on(t.customerId, t.lastMessageAt),
    index("conversations_business_last_message_idx").on(t.businessId, t.lastMessageAt),
    check(
      "conversations_scoped",
      sql`num_nonnulls(${t.quoteRequestId}, ${t.bookingId}) >= 1`,
    ),
  ],
);

/**
 * Append-only chat messages. `masked_body` has phone numbers and emails redacted and
 * is what the other party sees until the booking is paid (SPEC §7).
 */
export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderUserId: text("sender_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    senderRole: partyRole("sender_role").notNull(),
    body: text("body").notNull(),
    maskedBody: text("masked_body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_conversation_created_idx").on(t.conversationId, t.createdAt),
    check("messages_body_length", sql`char_length(${t.body}) BETWEEN 1 AND 5000`),
  ],
);
