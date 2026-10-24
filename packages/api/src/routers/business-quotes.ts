import { quoteDeclineSchema, quoteReplySchema } from "@nevile/core";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { CONVERSATION_ROLES } from "../photos.ts";
import { businessQuoteRequests, declineRequest, sendQuote } from "../quotes/flows.ts";
import { businessMemberProcedure, router } from "../trpc.ts";
import { bookingDeps } from "./bookings.ts";

/** Quote requests are for the owner and managers only (SPEC §20). */
const handler = businessMemberProcedure(CONVERSATION_ROLES);
const requestIdInput = z.object({ requestId: z.uuid() });

/** Business mode: quote requests and replies (SPEC §20). */
export const businessQuotesRouter = router({
  list: handler.query(async ({ ctx }) => {
    const rows = await businessQuoteRequests(ctx.db, ctx.business.id, ctx.now());
    return {
      needsReply: rows.filter((row) => row.status === "open" && row.canReply),
      quoted: rows.filter((row) => row.status === "quoted"),
      closed: rows
        .filter((row) => !row.canReply && row.status !== "quoted")
        .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime()),
    };
  }),

  get: handler.input(requestIdInput).query(async ({ ctx, input }) => {
    const [row] = await businessQuoteRequests(ctx.db, ctx.business.id, ctx.now(), input.requestId);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Quote request not found." });
    return row;
  }),

  /** Sends a quote, or a revised one that replaces it. */
  reply: handler
    .input(requestIdInput.extend(quoteReplySchema.shape))
    .mutation(async ({ ctx, input }) => {
      const { requestId, businessId: _businessId, ...quote } = input;
      await sendQuote(bookingDeps(ctx), ctx.user.id, ctx.business.id, requestId, quote);
      return { ok: true as const };
    }),

  decline: handler
    .input(requestIdInput.extend(quoteDeclineSchema.shape))
    .mutation(async ({ ctx, input }) => {
      await declineRequest(bookingDeps(ctx), ctx.business.id, input.requestId, {
        reason: input.reason,
      });
      return { ok: true as const };
    }),
});
