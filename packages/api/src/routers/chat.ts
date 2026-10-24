import { messageInputSchema } from "@nevile/core";
import { and, businessMembers, count, desc, eq, inArray, isNull, notifications } from "@nevile/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  conversationMessages,
  conversationSummary,
  listConversations,
  markRead,
  requireConversation,
  sendMessage,
  unreadConversationCount,
} from "../chat/flows.ts";
import { CONVERSATION_ROLES } from "../photos.ts";
import { protectedProcedure, router, verifiedProcedure } from "../trpc.ts";

const conversationIdInput = z.object({ conversationId: z.uuid() });

/** Customer ↔ business chat (SPEC §20). The server decides which side the viewer is on. */
export const chatRouter = router({
  /** The viewer's conversations as a customer, or as one of their businesses. */
  conversations: protectedProcedure
    .input(z.object({ businessId: z.uuid().optional() }).default({}))
    .query(async ({ ctx, input }) => {
      if (!input.businessId) {
        return listConversations(ctx.db, { side: "customer", customerId: ctx.user.id });
      }
      const [member] = await ctx.db
        .select({ id: businessMembers.id })
        .from(businessMembers)
        .where(
          and(
            eq(businessMembers.businessId, input.businessId),
            eq(businessMembers.userId, ctx.user.id),
            eq(businessMembers.active, true),
            inArray(businessMembers.role, [...CONVERSATION_ROLES]),
          ),
        )
        .limit(1);
      if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found." });
      return listConversations(ctx.db, { side: "business", businessId: input.businessId });
    }),

  /** A conversation's header and messages; opening it marks it read. */
  thread: protectedProcedure.input(conversationIdInput).query(async ({ ctx, input }) => {
    const access = await requireConversation(ctx.db, ctx.user.id, input.conversationId);
    const messages = await conversationMessages(ctx.db, access);
    await markRead(ctx.db, access, ctx.now());
    return { conversation: await conversationSummary(ctx.db, access), messages };
  }),

  /** New messages since `after` (polled while a conversation is open). */
  since: protectedProcedure
    .input(conversationIdInput.extend({ after: z.date().nullable() }))
    .query(async ({ ctx, input }) => {
      const access = await requireConversation(ctx.db, ctx.user.id, input.conversationId);
      const messages = await conversationMessages(ctx.db, access, {
        after: input.after ?? undefined,
      });
      if (messages.length > 0) await markRead(ctx.db, access, ctx.now());
      return messages;
    }),

  send: verifiedProcedure
    .input(conversationIdInput.and(messageInputSchema))
    .mutation(({ ctx, input }) => {
      const { conversationId, ...message } = input;
      return sendMessage(ctx, ctx.user.id, conversationId, message);
    }),

  /** Badge counts: unread conversations and unread notifications. */
  unread: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.user.id), isNull(notifications.readAt)));
    return {
      conversations: await unreadConversationCount(ctx.db, ctx.user.id),
      notifications: row?.n ?? 0,
    };
  }),

  /** The latest in-app notifications (quotes, declines, closed requests). */
  notifications: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, ctx.user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    return rows.map((row) => {
      const payload = row.payload as { text?: unknown; path?: unknown };
      return {
        id: row.id,
        type: row.type,
        text: typeof payload.text === "string" ? payload.text : "",
        path:
          typeof payload.path === "string" && payload.path.startsWith("/")
            ? payload.path
            : "/inbox",
        read: row.readAt !== null,
        createdAt: row.createdAt,
      };
    });
  }),

  markNotificationsRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(notifications)
      .set({ readAt: ctx.now() })
      .where(and(eq(notifications.userId, ctx.user.id), isNull(notifications.readAt)));
    return { ok: true as const };
  }),
});
