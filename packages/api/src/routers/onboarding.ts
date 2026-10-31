import { onboardingSchema } from "@nevile/core";
import { profiles, sql } from "@nevile/db";
import { onboardingState } from "../profile-state.ts";
import { protectedProcedure, router } from "../trpc.ts";

const onboardingColumns = {
  onboardingIntent: profiles.onboardingIntent,
  postalCode: profiles.postalCode,
  interests: profiles.interests,
  onboardedAt: profiles.onboardedAt,
};

/** Keeps the first time the welcome was finished or skipped. */
const firstOnboardedAt = sql`coalesce(${profiles.onboardedAt}, excluded.onboarded_at)`;

/**
 * The optional welcome (SPEC §16). Open to unverified users: onboarding is not behind the
 * verification gate. Both mutations are idempotent and return the onboarding state.
 */
export const onboardingRouter = router({
  /** Saves the three welcome answers; the postal code must be in Nova Scotia (SPEC §2). */
  save: protectedProcedure.input(onboardingSchema).mutation(async ({ ctx, input }) => {
    const now = new Date();
    const [row] = await ctx.db
      .insert(profiles)
      .values({
        userId: ctx.user.id,
        displayName: ctx.user.name,
        onboardingIntent: input.intent,
        postalCode: input.postalCode,
        interests: input.interests,
        onboardedAt: now,
      })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: {
          onboardingIntent: input.intent,
          postalCode: input.postalCode,
          interests: input.interests,
          onboardedAt: firstOnboardedAt,
          updatedAt: now,
        },
      })
      .returning(onboardingColumns);
    return onboardingState(row);
  }),

  /** "Skip for now": hides the welcome without changing any saved answers. */
  skip: protectedProcedure.mutation(async ({ ctx }) => {
    const now = new Date();
    const [row] = await ctx.db
      .insert(profiles)
      .values({ userId: ctx.user.id, displayName: ctx.user.name, onboardedAt: now })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: { onboardedAt: firstOnboardedAt, updatedAt: now },
      })
      .returning(onboardingColumns);
    return onboardingState(row);
  }),
});
