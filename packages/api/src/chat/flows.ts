import type { EmailSender } from "@nevile/auth";
import {
  MESSAGE_LIMITS,
  type MessageInput,
  MS_PER_DAY,
  MS_PER_MINUTE,
  maskContactInfo,
  messageInputSchema,
  unreadEmailDue,
} from "@nevile/core";
import {
  and,
  asc,
  bookings,
  businesses,
  businessMembers,
  type Conversation,
  conversations,
  count,
  type Database,
  type DbExecutor,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  messages,
  or,
  payments,
  quoteRequestGroups,
  quoteRequests,
  serviceCategories,
  sql,
  user,
} from "@nevile/db";
import { TRPCError } from "@trpc/server";
import { businessTeamEmails, customerEmail } from "../bookings/emails.ts";
import { firstName } from "../bookings/views.ts";
import type { ApiConfig } from "../config.ts";
import { sendAll } from "../notify.ts";
import { attachPhotos, CONVERSATION_ROLES, photosFor } from "../photos.ts";
import { chatEmails } from "./emails.ts";

export type ChatSide = "customer" | "business";

/** A conversation and which side the viewer is on (business side: owner or manager). */
export type ConversationAccess = { conversation: Conversation; side: ChatSide };

/** Opens (or returns) the conversation for a quote request or a booking. */
export async function openConversation(
  tx: DbExecutor,
  scope: { customerId: string; businessId: string } & (
    | { quoteRequestId: string }
    | { bookingId: string }
  ),
): Promise<string> {
  const existing =
    "quoteRequestId" in scope
      ? await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.quoteRequestId, scope.quoteRequestId))
      : await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.bookingId, scope.bookingId));
  if (existing[0]) return existing[0].id;
  const [row] = await tx.insert(conversations).values(scope).returning({ id: conversations.id });
  if (!row) throw new Error("conversation insert returned nothing");
  return row.id;
}

/** The viewer's access to a conversation, or null (callers answer NOT_FOUND). */
export async function conversationAccess(
  db: DbExecutor,
  userId: string,
  conversationId: string,
): Promise<ConversationAccess | null> {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  if (!conversation) return null;
  if (conversation.customerId === userId) return { conversation, side: "customer" };
  const [member] = await db
    .select({ id: businessMembers.id })
    .from(businessMembers)
    .where(
      and(
        eq(businessMembers.businessId, conversation.businessId),
        eq(businessMembers.userId, userId),
        eq(businessMembers.active, true),
        inArray(businessMembers.role, [...CONVERSATION_ROLES]),
      ),
    )
    .limit(1);
  return member ? { conversation, side: "business" } : null;
}

export async function requireConversation(
  db: DbExecutor,
  userId: string,
  conversationId: string,
): Promise<ConversationAccess> {
  const access = await conversationAccess(db, userId, conversationId);
  if (!access) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found." });
  return access;
}

/** Contact details are shared once any booking between the two is paid (SPEC §7). */
export async function contactShared(
  db: DbExecutor,
  customerId: string,
  businessId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(bookings, eq(bookings.id, payments.bookingId))
    .where(
      and(
        eq(bookings.customerId, customerId),
        eq(bookings.businessId, businessId),
        inArray(payments.status, ["succeeded", "partially_refunded", "refunded"]),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Sends a message (text and/or photos). Contact details are masked for the other side. */
export async function sendMessage(
  deps: { db: Database; now: () => Date },
  userId: string,
  conversationId: string,
  raw: MessageInput,
): Promise<{ id: string }> {
  const input = messageInputSchema.parse(raw);
  const now = deps.now();
  const { conversation, side } = await requireConversation(deps.db, userId, conversationId);
  const [recent] = await deps.db
    .select({ n: count() })
    .from(messages)
    .where(
      and(
        eq(messages.senderUserId, userId),
        gte(messages.createdAt, new Date(now.getTime() - MS_PER_MINUTE)),
      ),
    );
  if ((recent?.n ?? 0) >= MESSAGE_LIMITS.perMinute) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "You're sending messages very quickly. Wait a moment and try again.",
    });
  }
  return deps.db.transaction(async (tx) => {
    const [message] = await tx
      .insert(messages)
      .values({
        conversationId,
        senderUserId: userId,
        senderRole: side,
        body: input.body,
        maskedBody: maskContactInfo(input.body),
        createdAt: now,
      })
      .returning({ id: messages.id });
    if (!message) throw new Error("message insert returned nothing");
    await attachPhotos(tx, userId, input.photoIds, { messageId: message.id });
    await tx
      .update(conversations)
      .set({
        lastMessageAt: now,
        // Writing counts as reading what came before.
        ...(side === "customer" ? { customerLastReadAt: now } : { businessLastReadAt: now }),
        updatedAt: now,
      })
      .where(eq(conversations.id, conversationId));
    // A business's first message counts as its reply to the quote request.
    if (side === "business" && conversation.quoteRequestId) {
      await tx
        .update(quoteRequests)
        .set({ respondedAt: now })
        .where(
          and(
            eq(quoteRequests.id, conversation.quoteRequestId),
            sql`${quoteRequests.respondedAt} IS NULL`,
          ),
        );
    }
    return { id: message.id };
  });
}

export async function markRead(
  db: DbExecutor,
  access: ConversationAccess,
  now: Date,
): Promise<void> {
  await db
    .update(conversations)
    .set(access.side === "customer" ? { customerLastReadAt: now } : { businessLastReadAt: now })
    .where(eq(conversations.id, access.conversation.id));
}

/** Messages in a conversation as `side` sees them, oldest first (optionally after one). */
export async function conversationMessages(
  db: DbExecutor,
  access: ConversationAccess,
  options: { after?: Date; limit?: number } = {},
) {
  const { conversation, side } = access;
  const shared = await contactShared(db, conversation.customerId, conversation.businessId);
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversation.id),
        options.after ? gt(messages.createdAt, options.after) : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(options.limit ?? 200);
  rows.reverse();
  const photos = await photosFor(db, { messageIds: rows.map((row) => row.id) });
  return rows.map((row) => {
    const mine = row.senderRole === side;
    return {
      id: row.id,
      mine,
      senderRole: row.senderRole,
      body: mine || shared ? row.body : row.maskedBody,
      photos: photos.get(row.id) ?? [],
      createdAt: row.createdAt,
    };
  });
}

/** One conversation's header: who it's with and what it's about. */
export async function conversationSummary(db: DbExecutor, access: ConversationAccess) {
  const { conversation, side } = access;
  const [business] = await db
    .select({ name: businesses.name, slug: businesses.slug })
    .from(businesses)
    .where(eq(businesses.id, conversation.businessId));
  const [customer] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, conversation.customerId));
  const topic = await conversationTopics(db, [conversation]);
  return {
    id: conversation.id,
    side,
    businessId: conversation.businessId,
    with: side === "customer" ? (business?.name ?? "Business") : firstName(customer?.name),
    business: business ?? null,
    topic: topic.get(conversation.id) ?? "Conversation",
    bookingId: conversation.bookingId,
    quoteRequestId: conversation.quoteRequestId,
    contactShared: await contactShared(db, conversation.customerId, conversation.businessId),
  };
}

/** "Quote: Lawn Mowing" or the booked job's title, per conversation. */
async function conversationTopics(
  db: DbExecutor,
  rows: readonly Conversation[],
): Promise<Map<string, string>> {
  const topics = new Map<string, string>();
  const bookingIds = rows.flatMap((row) => (row.bookingId ? [row.bookingId] : []));
  if (bookingIds.length > 0) {
    const booked = await db
      .select({ id: bookings.id, title: bookings.title })
      .from(bookings)
      .where(inArray(bookings.id, bookingIds));
    const titles = new Map(booked.map((row) => [row.id, row.title]));
    for (const row of rows) {
      if (row.bookingId && titles.has(row.bookingId))
        topics.set(row.id, titles.get(row.bookingId) ?? "");
    }
  }
  const requestIds = rows.flatMap((row) =>
    row.quoteRequestId && !topics.has(row.id) ? [row.quoteRequestId] : [],
  );
  if (requestIds.length > 0) {
    const requested = await db
      .select({ id: quoteRequests.id, category: serviceCategories.name })
      .from(quoteRequests)
      .innerJoin(quoteRequestGroups, eq(quoteRequestGroups.id, quoteRequests.groupId))
      .innerJoin(serviceCategories, eq(serviceCategories.id, quoteRequestGroups.categoryId))
      .where(inArray(quoteRequests.id, requestIds));
    const categories = new Map(requested.map((row) => [row.id, row.category]));
    for (const row of rows) {
      if (row.quoteRequestId && categories.has(row.quoteRequestId)) {
        topics.set(row.id, `Quote: ${categories.get(row.quoteRequestId)}`);
      }
    }
  }
  return topics;
}

/** Conversations for one side, most recent first, with unread counts and a preview. */
export async function listConversations(
  db: DbExecutor,
  who: { side: "customer"; customerId: string } | { side: "business"; businessId: string },
) {
  const rows = await db
    .select()
    .from(conversations)
    .where(
      who.side === "customer"
        ? eq(conversations.customerId, who.customerId)
        : eq(conversations.businessId, who.businessId),
    )
    .orderBy(desc(sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`))
    .limit(100);
  if (rows.length === 0) return [];
  const topics = await conversationTopics(db, rows);
  const businessRows = await db
    .select({ id: businesses.id, name: businesses.name })
    .from(businesses)
    .where(inArray(businesses.id, [...new Set(rows.map((row) => row.businessId))]));
  const businessNames = new Map(businessRows.map((row) => [row.id, row.name]));
  const customerRows = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, [...new Set(rows.map((row) => row.customerId))]));
  const customerNames = new Map(customerRows.map((row) => [row.id, row.name]));

  const result = [];
  for (const row of rows) {
    const lastRead = who.side === "customer" ? row.customerLastReadAt : row.businessLastReadAt;
    const other = who.side === "customer" ? "business" : "customer";
    const [unread] = await db
      .select({ n: count() })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, row.id),
          eq(messages.senderRole, other),
          lastRead ? gt(messages.createdAt, lastRead) : undefined,
        ),
      );
    const [last] = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, row.id))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    const shared = last ? await contactShared(db, row.customerId, row.businessId) : false;
    const preview = last
      ? last.senderRole === who.side || shared
        ? last.body
        : last.maskedBody
      : "";
    result.push({
      id: row.id,
      with:
        who.side === "customer"
          ? (businessNames.get(row.businessId) ?? "Business")
          : firstName(customerNames.get(row.customerId)),
      topic: topics.get(row.id) ?? "Conversation",
      preview: preview || (last ? "Photo" : "No messages yet"),
      lastMessageAt: row.lastMessageAt,
      unread: unread?.n ?? 0,
      mineLast: last ? last.senderRole === who.side : false,
    });
  }
  return result;
}

/** Unread conversations for the signed-in person, across their customer and business sides. */
export async function unreadConversationCount(db: DbExecutor, userId: string): Promise<number> {
  const memberships = await db
    .select({ businessId: businessMembers.businessId })
    .from(businessMembers)
    .where(
      and(
        eq(businessMembers.userId, userId),
        eq(businessMembers.active, true),
        inArray(businessMembers.role, [...CONVERSATION_ROLES]),
      ),
    );
  const businessIds = memberships.map((row) => row.businessId);
  const [row] = await db
    .select({ n: count() })
    .from(conversations)
    .where(
      or(
        and(
          eq(conversations.customerId, userId),
          isNotNull(conversations.lastMessageAt),
          sql`EXISTS (SELECT 1 FROM ${messages} WHERE ${messages.conversationId} = ${conversations.id}
            AND ${messages.senderRole} = 'business'
            AND ${messages.createdAt} > coalesce(${conversations.customerLastReadAt}, '-infinity'))`,
        ),
        businessIds.length > 0
          ? and(
              inArray(conversations.businessId, businessIds),
              sql`EXISTS (SELECT 1 FROM ${messages} WHERE ${messages.conversationId} = ${conversations.id}
                AND ${messages.senderRole} = 'customer'
                AND ${messages.createdAt} > coalesce(${conversations.businessLastReadAt}, '-infinity'))`,
            )
          : undefined,
      ),
    );
  return row?.n ?? 0;
}

/**
 * One email per conversation and side when a message has been unread for 10 minutes
 * (SPEC §20). Looks back 7 days; marks the side as emailed so a burst sends one email.
 */
export async function emailUnreadMessages(deps: {
  db: Database;
  email: EmailSender;
  config: ApiConfig;
  now: () => Date;
}): Promise<number> {
  const now = deps.now();
  const since = new Date(now.getTime() - 7 * MS_PER_DAY);
  const candidates = await deps.db
    .select()
    .from(conversations)
    .where(and(isNotNull(conversations.lastMessageAt), gt(conversations.lastMessageAt, since)));
  let sent = 0;
  for (const row of candidates) {
    for (const side of ["customer", "business"] as const) {
      const lastRead = side === "customer" ? row.customerLastReadAt : row.businessLastReadAt;
      const emailed = side === "customer" ? row.customerEmailedAt : row.businessEmailedAt;
      const seen = Math.max(lastRead?.getTime() ?? 0, emailed?.getTime() ?? 0);
      const unseen = await deps.db
        .select({ createdAt: messages.createdAt })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, row.id),
            eq(messages.senderRole, side === "customer" ? "business" : "customer"),
            gt(messages.createdAt, new Date(seen)),
          ),
        )
        .orderBy(asc(messages.createdAt));
      if (!unreadEmailDue({ oldestUnseenAt: unseen[0]?.createdAt ?? null, now })) continue;
      const claimed = await deps.db
        .update(conversations)
        .set(side === "customer" ? { customerEmailedAt: now } : { businessEmailedAt: now })
        .where(
          and(
            eq(conversations.id, row.id),
            emailed
              ? eq(
                  side === "customer"
                    ? conversations.customerEmailedAt
                    : conversations.businessEmailedAt,
                  emailed,
                )
              : sql`${side === "customer" ? conversations.customerEmailedAt : conversations.businessEmailedAt} IS NULL`,
          ),
        )
        .returning({ id: conversations.id });
      if (claimed.length === 0) continue;
      const access: ConversationAccess = { conversation: row, side };
      const summary = await conversationSummary(deps.db, access);
      const recipients =
        side === "customer"
          ? await customerEmail(deps.db, row.customerId)
          : await businessTeamEmails(deps.db, row.businessId);
      await sendAll(
        deps.email,
        chatEmails.unread(recipients, {
          from: summary.with,
          topic: summary.topic,
          count: unseen.length,
          link: `${deps.config.siteUrl}/inbox/${row.id}`,
        }),
      );
      sent += 1;
    }
  }
  return sent;
}
