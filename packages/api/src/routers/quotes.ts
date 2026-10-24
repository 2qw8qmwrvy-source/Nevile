import { contactEmail } from "@nevile/auth";
import {
  bookingRequestSchema,
  CANCELLATION_POLICIES,
  CATEGORY_SLUGS,
  canTakeBookings,
  launchPostalCodeSchema,
  quoteRequestInputSchema,
} from "@nevile/core";
import { businesses, eq } from "@nevile/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { startQuoteAppCheckout, startQuoteCheckout } from "../bookings/flows.ts";
import {
  bookableQuote,
  closeRequestGroup,
  customerQuoteGroups,
  quoteTargets,
  requestQuotes,
} from "../quotes/flows.ts";
import { protectedProcedure, router, verifiedProcedure } from "../trpc.ts";
import { bookingDeps, openWindows } from "./bookings.ts";

const groupIdInput = z.object({ groupId: z.uuid() });

/** Asking pros for quotes and booking one (SPEC §20), as a customer. */
export const quotesRouter = router({
  /** Checks which of the picked pros can be asked, before the customer writes the request. */
  targets: protectedProcedure
    .input(
      z.object({
        categorySlug: z.enum(CATEGORY_SLUGS),
        postalCode: launchPostalCodeSchema,
        businessIds: z.array(z.uuid()).min(1).max(3),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await quoteTargets(ctx.db, { customerId: ctx.user.id, ...input }, ctx.now());
      return {
        categoryName: result.categoryName,
        area: result.area,
        pros: result.targets.map(({ business, problem }) => ({
          id: business.id,
          name: business.name,
          slug: business.slug,
          problem,
        })),
      };
    }),

  request: verifiedProcedure
    .input(quoteRequestInputSchema)
    .mutation(({ ctx, input }) =>
      requestQuotes(bookingDeps(ctx), { id: ctx.user.id, name: ctx.user.name }, input),
    ),

  list: protectedProcedure.query(({ ctx }) => customerQuoteGroups(ctx.db, ctx.user.id, ctx.now())),

  get: protectedProcedure.input(groupIdInput).query(async ({ ctx, input }) => {
    const [group] = await customerQuoteGroups(ctx.db, ctx.user.id, ctx.now(), input.groupId);
    if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "Quote request not found." });
    return group;
  }),

  close: verifiedProcedure.input(groupIdInput).mutation(async ({ ctx, input }) => {
    await closeRequestGroup(bookingDeps(ctx), ctx.user.id, input.groupId);
    return { ok: true as const };
  }),

  /** Open windows for booking a quote: its duration, the business's windows and rules. */
  bookingOptions: protectedProcedure
    .input(
      z.object({
        quoteId: z.uuid(),
        from: z.string().optional(),
        days: z.number().int().min(1).max(14).default(7),
      }),
    )
    .query(async ({ ctx, input }) => {
      const now = ctx.now();
      const { quote, request, group, category } = await bookableQuote(
        ctx.db,
        ctx.user.id,
        input.quoteId,
        now,
      );
      const [business] = await ctx.db
        .select()
        .from(businesses)
        .where(eq(businesses.id, request.businessId));
      if (!business) throw new TRPCError({ code: "NOT_FOUND", message: "Quote not found." });
      const [view] = await customerQuoteGroups(ctx.db, ctx.user.id, now, group.id);
      const pro = view?.pros.find((candidate) => candidate.requestId === request.id);
      return {
        groupId: group.id,
        title: `${category.name} (quoted)`,
        business: { name: business.name, slug: business.slug },
        quote: pro?.quote ?? null,
        postalArea: group.postalArea,
        cancellationPolicy: {
          label: CANCELLATION_POLICIES[business.cancellationPolicy].label,
          description: CANCELLATION_POLICIES[business.cancellationPolicy].description,
        },
        bookingOpen: canTakeBookings({
          payoutsEnabled: business.payoutsEnabled,
          payoutSetupDueAt: business.payoutSetupDueAt,
          now,
        }),
        ...(await openWindows(ctx, business, quote.durationMinutes ?? 60, input)),
      };
    }),

  /** Booking an accepted quote, paid inside the app (SPEC §20). */
  appCheckout: verifiedProcedure
    .input(bookingRequestSchema.omit({ serviceId: true }).extend({ quoteId: z.uuid() }))
    .mutation(({ ctx, input }) =>
      startQuoteAppCheckout(
        bookingDeps(ctx),
        { id: ctx.user.id, email: contactEmail(ctx.user.email) },
        input,
      ),
    ),

  /** Holds the window and opens the payment page for an accepted quote. */
  checkout: verifiedProcedure
    .input(bookingRequestSchema.omit({ serviceId: true }).extend({ quoteId: z.uuid() }))
    .mutation(({ ctx, input }) =>
      startQuoteCheckout(
        bookingDeps(ctx),
        { id: ctx.user.id, email: contactEmail(ctx.user.email) },
        input,
      ),
    ),
});
