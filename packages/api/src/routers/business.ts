import { randomBytes } from "node:crypto";
import {
  BUSINESS_NAME_MAX_LENGTH,
  BUSINESS_NAME_MIN_LENGTH,
  isLaunchProvince,
  OUTSIDE_LAUNCH_REGION_MESSAGE,
  PROVINCES,
  provinceCodeSchema,
} from "@nevile/core";
import {
  and,
  asc,
  type Business,
  businesses,
  businessMembers,
  type DbExecutor,
  eq,
  like,
  type NewBusiness,
  or,
  profiles,
  sql,
} from "@nevile/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { addDefaultHours } from "../bookings/schedule.ts";
import { slugify } from "../slug.ts";
import { businessMemberProcedure, router, verifiedProcedure } from "../trpc.ts";

export { BUSINESS_NAME_MAX_LENGTH, BUSINESS_NAME_MIN_LENGTH };

export const createBusinessInput = z.object({
  name: z
    .string()
    .trim()
    .min(BUSINESS_NAME_MIN_LENGTH, { message: "Enter your business name" })
    .max(BUSINESS_NAME_MAX_LENGTH, {
      message: `Business names can be up to ${BUSINESS_NAME_MAX_LENGTH} characters`,
    })
    .regex(/^[^\p{Cc}]+$/u, { message: "Business names can't contain control characters" }),
  // SPEC §2: businesses can only be set up in a launch province (Nova Scotia).
  province: provinceCodeSchema.refine((code) => isLaunchProvince(code), {
    message: OUTSIDE_LAUNCH_REGION_MESSAGE,
  }),
});

/** Fields of a business that its members may see (no Stripe or tax identifiers). */
function publicBusiness(business: Business) {
  return {
    id: business.id,
    name: business.name,
    slug: business.slug,
    province: business.province,
    timezone: business.timezone,
    plan: business.plan,
    instantBook: business.instantBook,
    cancellationPolicy: business.cancellationPolicy,
    payoutsEnabled: business.payoutsEnabled,
    verified: business.verifiedInsuranceAt !== null,
    createdAt: business.createdAt,
  };
}

/**
 * Inserts the business under the first free slug: the name's slug, then `-2`, `-3`, ...
 * `ON CONFLICT DO NOTHING` keeps the transaction usable if a concurrent insert takes the
 * slug first; that case retries with a random suffix.
 */
async function insertWithUniqueSlug(
  tx: DbExecutor,
  values: Omit<NewBusiness, "slug">,
): Promise<Business> {
  const base = slugify(values.name) || "business";
  const taken = await tx
    .select({ slug: businesses.slug })
    .from(businesses)
    .where(or(eq(businesses.slug, base), like(businesses.slug, `${base}-%`)));
  const used = new Set(taken.map((row) => row.slug));
  let candidate = base;
  for (let n = 2; used.has(candidate); n += 1) candidate = `${base}-${n}`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [row] = await tx
      .insert(businesses)
      .values({ ...values, slug: candidate })
      .onConflictDoNothing({ target: businesses.slug })
      .returning();
    if (row) return row;
    candidate = `${base}-${randomBytes(3).toString("hex")}`;
  }
  throw new TRPCError({
    code: "CONFLICT",
    message: "Couldn't reserve a web address for this business. Please try again.",
  });
}

export const businessRouter = router({
  /**
   * "Switch to business mode" (SPEC §1): creates the caller's business with them as owner
   * and switches their profile to business mode. One owned business per account. Business
   * tools need a verified contact.
   */
  create: verifiedProcedure.input(createBusinessInput).mutation(async ({ ctx, input }) => {
    const { user } = ctx;
    const created = await ctx.db.transaction(async (tx) => {
      // Serializes concurrent requests from the same user (double-clicks, retries).
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`business-create:${user.id}`}))`,
      );
      const [owned] = await tx
        .select({ id: businesses.id })
        .from(businesses)
        .where(eq(businesses.ownerUserId, user.id))
        .limit(1);
      if (owned) {
        throw new TRPCError({ code: "CONFLICT", message: "You already have a business." });
      }

      const business = await insertWithUniqueSlug(tx, {
        ownerUserId: user.id,
        name: input.name,
        province: input.province,
        timezone: PROVINCES[input.province].timeZone,
      });
      const [owner] = await tx
        .insert(businessMembers)
        .values({ businessId: business.id, userId: user.id, role: "owner" })
        .returning({ id: businessMembers.id });
      // The owner starts with default working hours, so the business is bookable (SPEC §19).
      if (owner) await addDefaultHours(tx, owner.id);
      await tx
        .insert(profiles)
        .values({ userId: user.id, displayName: user.name, activeMode: "business" })
        .onConflictDoUpdate({ target: profiles.userId, set: { activeMode: "business" } });
      return business;
    });
    return { ...publicBusiness(created), role: "owner" as const };
  }),

  /** Businesses the caller belongs to, with their role in each. */
  mine: verifiedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ business: businesses, role: businessMembers.role })
      .from(businessMembers)
      .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
      .where(and(eq(businessMembers.userId, ctx.user.id), eq(businessMembers.active, true)))
      .orderBy(asc(businesses.name));
    return rows.map((row) => ({ ...publicBusiness(row.business), role: row.role }));
  }),

  /** One business the caller is a member of. */
  get: businessMemberProcedure().query(({ ctx }) => ({
    ...publicBusiness(ctx.business),
    role: ctx.membership.role,
  })),
});
