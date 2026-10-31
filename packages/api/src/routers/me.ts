import { contactEmail, verificationMethodOf } from "@nevile/auth";
import { and, asc, businesses, businessMembers, eq, profiles } from "@nevile/db";
import { marketingConsentState, onboardingState } from "../profile-state.ts";
import { protectedProcedure, router } from "../trpc.ts";

export const meRouter = router({
  /**
   * The caller's account, app profile, verification and onboarding state, and business
   * memberships. Only ever the caller's own.
   */
  get: protectedProcedure.query(async ({ ctx }) => {
    const { user } = ctx;
    const [profileRow] = await ctx.db
      .select({
        displayName: profiles.displayName,
        activeMode: profiles.activeMode,
        defaultAddressId: profiles.defaultAddressId,
        onboardingIntent: profiles.onboardingIntent,
        postalCode: profiles.postalCode,
        interests: profiles.interests,
        onboardedAt: profiles.onboardedAt,
        marketingConsentAt: profiles.marketingConsentAt,
        marketingConsentVersion: profiles.marketingConsentVersion,
      })
      .from(profiles)
      .where(eq(profiles.userId, user.id))
      .limit(1);
    const memberships = await ctx.db
      .select({
        role: businessMembers.role,
        business: {
          id: businesses.id,
          name: businesses.name,
          slug: businesses.slug,
          province: businesses.province,
          plan: businesses.plan,
        },
      })
      .from(businessMembers)
      .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
      .where(and(eq(businessMembers.userId, user.id), eq(businessMembers.active, true)))
      .orderBy(asc(businesses.name));

    // Phone-only accounts carry a placeholder address internally; never expose it.
    const email = contactEmail(user.email);
    const verificationMethod = verificationMethodOf(user);
    return {
      user: {
        id: user.id,
        name: user.name,
        email,
        emailVerified: email ? user.emailVerified : false,
        phoneNumber: user.phoneNumber ?? null,
        phoneNumberVerified: user.phoneNumberVerified ?? false,
        image: user.image ?? null,
        createdAt: user.createdAt,
      },
      profile: profileRow
        ? {
            displayName: profileRow.displayName,
            activeMode: profileRow.activeMode,
            defaultAddressId: profileRow.defaultAddressId,
          }
        : null,
      /** SPEC §1 gate: may book, pay, message and use business tools. */
      verified: verificationMethod !== null,
      /** How the contact was verified: "email" first, then "phone"; null when unverified. */
      verificationMethod,
      onboarding: onboardingState(profileRow),
      marketingConsent: marketingConsentState(profileRow),
      businesses: memberships,
    };
  }),
});
