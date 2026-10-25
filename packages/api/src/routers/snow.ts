import { contactEmail } from "@nevile/auth";
import { snowSignupSchema } from "@nevile/core";
import { z } from "zod";
import { contractOffer, signUpForContract } from "../ongoing/snow.ts";
import { publicProcedure, router, verifiedProcedure } from "../trpc.ts";
import { bookingDeps } from "./bookings.ts";

/** Snow contracts as a customer (SPEC §21). */
export const snowRouter = router({
  /**
   * A listed contract before signing up: terms, price and instalments for the chosen
   * plan, spots left, and the agreement text. Public; signed-in customers see their card.
   */
  offer: publicProcedure
    .input(
      z.object({
        serviceId: z.uuid(),
        seasonPayment: z.enum(["upfront", "monthly"]).nullable().default(null),
      }),
    )
    .query(({ ctx, input }) =>
      contractOffer(ctx, input.serviceId, {
        seasonPayment: input.seasonPayment,
        customer: ctx.session ? { id: ctx.session.user.id, name: ctx.session.user.name } : null,
      }),
    ),

  /** Signs up: needs a saved card and "I agree"; the pro has 24 hours to accept. */
  signUp: verifiedProcedure
    .input(snowSignupSchema)
    .mutation(({ ctx, input }) =>
      signUpForContract(
        { ...bookingDeps(ctx), storage: ctx.storage },
        { id: ctx.user.id, name: ctx.user.name || contactEmail(ctx.user.email) || "Customer" },
        input,
      ),
    ),
});
