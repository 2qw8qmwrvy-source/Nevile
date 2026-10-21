import { contactEmail } from "@nevile/auth";
import { and, asc, businesses, businessMembers, eq, profiles } from "@nevile/db";
import { protectedProcedure, router } from "../trpc.ts";

export const meRouter = router({
  /** The caller's account, app profile and business memberships. Only ever the caller's own. */
  get: protectedProcedure.query(async ({ ctx }) => {
    const { user } = ctx;
    const [profile] = await ctx.db
      .select({
        displayName: profiles.displayName,
        activeMode: profiles.activeMode,
        defaultAddressId: profiles.defaultAddressId,
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

    return {
      user: {
        id: user.id,
        name: user.name,
        // Phone-only accounts carry a placeholder address internally; never expose it.
        email: contactEmail(user.email),
        emailVerified: contactEmail(user.email) ? user.emailVerified : false,
        phoneNumber: user.phoneNumber ?? null,
        phoneNumberVerified: user.phoneNumberVerified ?? false,
        image: user.image ?? null,
        createdAt: user.createdAt,
      },
      profile: profile ?? null,
      businesses: memberships,
    };
  }),
});
