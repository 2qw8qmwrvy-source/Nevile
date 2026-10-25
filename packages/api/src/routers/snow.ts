import { contactEmail } from "@nevile/auth";
import { quotedSnowSignupSchema, snowSignupSchema } from "@nevile/core";
import { z } from "zod";
import type { Context } from "../context.ts";
import {
  contractOffer,
  listedContractSource,
  quotedContractSource,
  signUpForContract,
} from "../ongoing/snow.ts";
import { protectedProcedure, publicProcedure, router, verifiedProcedure } from "../trpc.ts";

const seasonPaymentInput = z.enum(["upfront", "monthly"]).nullable().default(null);

function signer(ctx: Context & { user: { id: string; name: string; email: string } }) {
  return { id: ctx.user.id, name: ctx.user.name || contactEmail(ctx.user.email) || "Customer" };
}

import { bookingDeps } from "./bookings.ts";

/** Snow contracts as a customer (SPEC §21). */
export const snowRouter = router({
  /**
   * A listed contract before signing up: terms, price and instalments for the chosen
   * plan, spots left, and the agreement text. Public; signed-in customers see their card.
   */
  offer: publicProcedure
    .input(z.object({ serviceId: z.uuid(), seasonPayment: seasonPaymentInput }))
    .query(async ({ ctx, input }) =>
      contractOffer(ctx, await listedContractSource(ctx.db, input.serviceId), {
        seasonPayment: input.seasonPayment,
        customer: ctx.session ? { id: ctx.session.user.id, name: ctx.session.user.name } : null,
      }),
    ),

  /** Signs up: needs a saved card and "I agree"; the pro has 24 hours to accept. */
  signUp: verifiedProcedure
    .input(snowSignupSchema)
    .mutation(async ({ ctx, input }) =>
      signUpForContract(
        { ...bookingDeps(ctx), storage: ctx.storage },
        signer(ctx),
        await listedContractSource(ctx.db, input.serviceId),
        input,
      ),
    ),

  /** The same offer for snow contract terms a pro sent in a quote. */
  quoteOffer: protectedProcedure
    .input(z.object({ quoteId: z.uuid(), seasonPayment: seasonPaymentInput }))
    .query(async ({ ctx, input }) =>
      contractOffer(
        ctx,
        await quotedContractSource(ctx.db, ctx.user.id, input.quoteId, ctx.now()),
        { seasonPayment: input.seasonPayment, customer: { id: ctx.user.id, name: ctx.user.name } },
      ),
    ),

  /** Signs up for a pro's quoted terms: confirmed at once (it's their own offer). */
  signUpFromQuote: verifiedProcedure
    .input(quotedSnowSignupSchema)
    .mutation(async ({ ctx, input }) =>
      signUpForContract(
        { ...bookingDeps(ctx), storage: ctx.storage },
        signer(ctx),
        await quotedContractSource(ctx.db, ctx.user.id, input.quoteId, ctx.now()),
        input,
      ),
    ),
});
