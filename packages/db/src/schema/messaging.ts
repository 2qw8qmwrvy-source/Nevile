import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { bookings } from "./bookings.ts";
import { businesses } from "./businesses.ts";
import { createdAt, id, timestamps, tstz } from "./columns.ts";
import { partyRole } from "./enums.ts";
import { quoteRequestGroups, quoteRequests } from "./quotes.ts";

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
    // Last "unread messages" email to each side (one per burst, SPEC §20).
    customerEmailedAt: tstz("customer_emailed_at"),
    businessEmailedAt: tstz("business_emailed_at"),
    ...timestamps(),
  },
  (t) => [
    index("conversations_customer_last_message_idx").on(t.customerId, t.lastMessageAt),
    index("conversations_business_last_message_idx").on(t.businessId, t.lastMessageAt),
    check("conversations_scoped", sql`num_nonnulls(${t.quoteRequestId}, ${t.bookingId}) >= 1`),
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
    // A photo-only message has an empty body (the API requires text or a photo).
    check("messages_body_length", sql`char_length(${t.body}) BETWEEN 0 AND 5000`),
  ],
);

/**
 * Private photos (SPEC §20): quote request photos and chat photos, re-encoded with all
 * metadata removed. Uploaded first (unattached, owned by the uploader), then attached to
 * one request or message; unattached uploads are deleted after a day. They are served
 * only to the people in that request or conversation, never from the public media URL.
 */
export const privatePhotos = pgTable(
  "private_photos",
  {
    id: id(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull().unique(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    quoteRequestGroupId: uuid("quote_request_group_id").references(() => quoteRequestGroups.id, {
      onDelete: "cascade",
    }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("private_photos_owner_created_idx").on(t.ownerUserId, t.createdAt),
    index("private_photos_group_idx").on(t.quoteRequestGroupId),
    index("private_photos_message_idx").on(t.messageId),
    index("private_photos_unattached_idx")
      .on(t.createdAt)
      .where(sql`${t.quoteRequestGroupId} IS NULL AND ${t.messageId} IS NULL`),
    check("private_photos_dimensions", sql`${t.width} > 0 AND ${t.height} > 0`),
    check(
      "private_photos_one_owner",
      sql`num_nonnulls(${t.quoteRequestGroupId}, ${t.messageId}) <= 1`,
    ),
  ],
);
