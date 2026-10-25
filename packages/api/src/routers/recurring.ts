import {
  quotedRecurringRequestSchema,
  quotedScheduleSchema,
  recurringRequestSchema,
  recurringScheduleSchema,
} from "@nevile/core";
import { z } from "zod";
import {
  previewSeries,
  quoteSeriesSource,
  requestSeries,
  serviceSeriesSource,
  skipVisit,
} from "../ongoing/recurring.ts";
import { protectedProcedure, publicProcedure, router, verifiedProcedure } from "../trpc.ts";
import { bookingDeps } from "./bookings.ts";

/** Recurring jobs as a customer (SPEC §21). */
export const recurringRouter = router({
  /** Every date of a proposed series: which fit, alternatives for full ones, the price. */
  preview: publicProcedure
    .input(recurringScheduleSchema)
    .query(async ({ ctx, input }) =>
      previewSeries(
        ctx,
        await serviceSeriesSource(ctx.db, input.serviceId, input.frequency),
        input,
      ),
    ),

  /** Sends the request: needs a saved card; the pro has 24 hours to accept. */
  request: verifiedProcedure
    .input(recurringRequestSchema)
    .mutation(async ({ ctx, input }) =>
      requestSeries(
        bookingDeps(ctx),
        { id: ctx.user.id, name: ctx.user.name },
        await serviceSeriesSource(ctx.db, input.serviceId, input.frequency),
        input,
      ),
    ),

  /** The same preview for a pro's recurring offer in a quote. */
  previewQuote: protectedProcedure
    .input(quotedScheduleSchema)
    .query(async ({ ctx, input }) =>
      previewSeries(
        ctx,
        await quoteSeriesSource(ctx.db, ctx.user.id, input.quoteId, input.frequency, ctx.now()),
        input,
      ),
    ),

  /** Books a pro's recurring offer: confirmed at once (it's their own quote). */
  requestFromQuote: verifiedProcedure
    .input(quotedRecurringRequestSchema)
    .mutation(async ({ ctx, input }) =>
      requestSeries(
        bookingDeps(ctx),
        { id: ctx.user.id, name: ctx.user.name },
        await quoteSeriesSource(ctx.db, ctx.user.id, input.quoteId, input.frequency, ctx.now()),
        input,
      ),
    ),

  /** Skips one visit; the cancellation policy applies to it. */
  skipVisit: verifiedProcedure
    .input(z.object({ bookingId: z.uuid(), visitId: z.uuid() }))
    .mutation(({ ctx, input }) =>
      skipVisit(bookingDeps(ctx), ctx.user.id, input.bookingId, input.visitId),
    ),
});
