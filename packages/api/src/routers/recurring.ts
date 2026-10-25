import { recurringRequestSchema, recurringScheduleSchema } from "@nevile/core";
import { z } from "zod";
import { previewSeries, requestSeries, skipVisit } from "../ongoing/recurring.ts";
import { publicProcedure, router, verifiedProcedure } from "../trpc.ts";
import { bookingDeps } from "./bookings.ts";

/** Recurring jobs as a customer (SPEC §21). */
export const recurringRouter = router({
  /** Every date of a proposed series: which fit, alternatives for full ones, the price. */
  preview: publicProcedure
    .input(recurringScheduleSchema)
    .query(({ ctx, input }) => previewSeries(ctx, input)),

  /** Sends the request: needs a saved card; the pro has 24 hours to accept. */
  request: verifiedProcedure
    .input(recurringRequestSchema)
    .mutation(({ ctx, input }) =>
      requestSeries(bookingDeps(ctx), { id: ctx.user.id, name: ctx.user.name }, input),
    ),

  /** Skips one visit; the cancellation policy applies to it. */
  skipVisit: verifiedProcedure
    .input(z.object({ bookingId: z.uuid(), visitId: z.uuid() }))
    .mutation(({ ctx, input }) =>
      skipVisit(bookingDeps(ctx), ctx.user.id, input.bookingId, input.visitId),
    ),
});
