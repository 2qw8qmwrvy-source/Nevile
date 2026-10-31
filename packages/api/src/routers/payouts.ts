import { contactEmail } from "@nevile/auth";
import { z } from "zod";
import {
  assertOwner,
  payoutSummary,
  refreshPayoutStatus,
  startPayoutSetup,
} from "../bookings/payouts.ts";
import { LISTING_EDITOR_ROLES } from "../listing-state.ts";
import { businessMemberProcedure, router } from "../trpc.ts";
import { bookingDeps } from "./bookings.ts";

const editor = businessMemberProcedure(LISTING_EDITOR_ROLES);

/** Payout setup (Stripe Connect) and payout history (SPEC §7, §19). */
export const payoutsRouter = router({
  status: editor.query(({ ctx }) => payoutSummary(bookingDeps(ctx), ctx.business)),

  /** Opens Stripe's payout setup (identity and bank account). Owner only. */
  start: editor
    .input(z.object({ returnTo: z.enum(["web", "app"]).default("web") }))
    .mutation(({ ctx, input }) => {
      assertOwner(ctx.membership.role);
      return startPayoutSetup(
        bookingDeps(ctx),
        ctx.business,
        contactEmail(ctx.user.email),
        input.returnTo,
      );
    }),

  /** Re-checks payout readiness after returning from setup. */
  refresh: editor.mutation(async ({ ctx }) => ({
    payoutsEnabled: await refreshPayoutStatus(bookingDeps(ctx), ctx.business),
  })),
});
