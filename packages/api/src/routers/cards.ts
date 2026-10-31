import { contactEmail } from "@nevile/auth";
import { cardSetups, eq } from "@nevile/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  type CardDeps,
  cardView,
  finishCardSetup,
  LOCAL_PATH,
  savedCardOf,
  startCardSetup,
} from "../cards/flows.ts";
import type { Context } from "../context.ts";
import { afterCardSaved } from "../ongoing/charges.ts";
import { protectedProcedure, router, verifiedProcedure } from "../trpc.ts";
import { bookingDeps, testProvider } from "./bookings.ts";

const setupIdInput = z.object({ setupId: z.uuid() });

function cardDeps(ctx: Context): CardDeps {
  return { db: ctx.db, payments: ctx.payments, config: ctx.config, now: ctx.now };
}

/** The customer's saved card for recurring jobs and snow contracts (SPEC §21). */
export const cardsRouter = router({
  /** The saved card, or null. */
  get: protectedProcedure.query(async ({ ctx }) => {
    const card = await savedCardOf(ctx.db, ctx.user.id, ctx.payments.name);
    return card ? cardView(card) : null;
  }),

  /** Opens the provider's card form: its page (website) or the payment sheet (app). */
  startSetup: verifiedProcedure
    .input(
      z.object({
        kind: z.enum(["page", "intent"]),
        returnPath: z.string().max(300).regex(LOCAL_PATH).nullish(),
      }),
    )
    .mutation(({ ctx, input }) =>
      startCardSetup(
        cardDeps(ctx),
        { id: ctx.user.id, email: contactEmail(ctx.user.email) },
        input,
      ),
    ),

  /** After the provider's page or sheet: stores the card (if the webhook hasn't yet). */
  finishSetup: protectedProcedure.input(setupIdInput).mutation(({ ctx, input }) =>
    finishCardSetup(cardDeps(ctx), input.setupId, {
      userId: ctx.user.id,
      onSaved: (userId) => afterCardSaved(bookingDeps(ctx), userId),
    }),
  ),

  /**
   * Development only: saves a test card for an in-app setup, like finishing the payment
   * sheet. `declining` saves one whose charges fail. NOT_FOUND in production and with Stripe.
   */
  payTestSetup: protectedProcedure
    .input(setupIdInput.extend({ declining: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const fake = testProvider(ctx);
      if (!fake) throw new TRPCError({ code: "NOT_FOUND", message: "Not available." });
      const result = await finishCardSetup(cardDeps(ctx), input.setupId, { userId: ctx.user.id });
      if (result.status === "unknown") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card setup not found." });
      }
      const [setup] = await ctx.db
        .select()
        .from(cardSetups)
        .where(eq(cardSetups.id, input.setupId))
        .limit(1);
      if (!setup?.providerSetupId || setup.status !== "open") return result;
      fake.completeCardSetup(setup.providerSetupId, { declining: input.declining });
      return finishCardSetup(cardDeps(ctx), input.setupId, {
        userId: ctx.user.id,
        onSaved: (userId) => afterCardSaved(bookingDeps(ctx), userId),
      });
    }),
});
