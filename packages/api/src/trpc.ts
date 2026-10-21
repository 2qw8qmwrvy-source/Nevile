import {
  and,
  BUSINESS_MEMBER_ROLES,
  type BusinessMemberRole,
  businesses,
  businessMembers,
  eq,
} from "@nevile/db";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError, z } from "zod";
import type { Context } from "./context.ts";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  // Input validation failures carry per-field messages so forms can show them inline.
  errorFormatter({ shape, error }) {
    const zodError =
      error.cause instanceof ZodError
        ? z.flattenError(error.cause as ZodError<Record<string, unknown>>)
        : null;
    return { ...shape, data: { ...shape.data, zodError } };
  },
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

/** Requires a signed-in caller; adds `ctx.user` (never taken from input). */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue." });
  }
  return next({ ctx: { session: ctx.session, user: ctx.session.user } });
});

export const businessIdInput = z.object({ businessId: z.uuid() });

/**
 * Procedures scoped to one business: takes `{ businessId }` input (extend it with more
 * `.input()` fields as needed), checks the caller is an active member with one of
 * `roles`, and adds `ctx.business` and `ctx.membership`. Non-members get NOT_FOUND so a
 * business id can't be probed; members without the role get FORBIDDEN.
 */
export function businessMemberProcedure(
  roles: readonly BusinessMemberRole[] = BUSINESS_MEMBER_ROLES,
) {
  return protectedProcedure.input(businessIdInput).use(async ({ ctx, input, next }) => {
    const [row] = await ctx.db
      .select({ membership: businessMembers, business: businesses })
      .from(businessMembers)
      .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
      .where(
        and(
          eq(businessMembers.businessId, input.businessId),
          eq(businessMembers.userId, ctx.user.id),
          eq(businessMembers.active, true),
        ),
      )
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found." });
    if (!roles.includes(row.membership.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Your role in this business doesn't allow that.",
      });
    }
    return next({ ctx: { business: row.business, membership: row.membership } });
  });
}
