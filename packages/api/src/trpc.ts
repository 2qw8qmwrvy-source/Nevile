import { hasVerifiedContact } from "@nevile/auth";
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

/**
 * Machine-readable reasons clients act on, sent as `error.data.reason` (null otherwise):
 * - VERIFICATION_REQUIRED (FORBIDDEN): confirm an email or phone number first (SPEC §1);
 * - NEIGHBOURS_DISABLED (PRECONDITION_FAILED): Nevile Neighbours is switched off (SPEC §15).
 */
export const API_ERROR_REASONS = {
  VERIFICATION_REQUIRED: "VERIFICATION_REQUIRED",
  NEIGHBOURS_DISABLED: "NEIGHBOURS_DISABLED",
  /** Recurring jobs and snow contracts charge a saved card: add one first (SPEC §21). */
  CARD_REQUIRED: "CARD_REQUIRED",
} as const;
export type ApiErrorReason = (typeof API_ERROR_REASONS)[keyof typeof API_ERROR_REASONS];

/** Carried as a TRPCError's `cause` to tag it with an `ApiErrorReason`. */
class ReasonCause extends Error {
  readonly reason: ApiErrorReason;
  constructor(reason: ApiErrorReason) {
    super(reason);
    this.name = "ReasonCause";
    this.reason = reason;
  }
}

export function reasonError(
  code: TRPCError["code"],
  message: string,
  reason: ApiErrorReason,
): TRPCError {
  return new TRPCError({ code, message, cause: new ReasonCause(reason) });
}

/** The `ApiErrorReason` of an error thrown by a server-side caller, if any. */
export function errorReasonOf(error: unknown): ApiErrorReason | null {
  return error instanceof TRPCError && error.cause instanceof ReasonCause
    ? error.cause.reason
    : null;
}

export const VERIFICATION_REQUIRED_MESSAGE =
  "Confirm your email address or phone number to continue.";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // Input validation failures carry per-field messages so forms can show them inline.
    const zodError =
      error.cause instanceof ZodError
        ? z.flattenError(error.cause as ZodError<Record<string, unknown>>)
        : null;
    return { ...shape, data: { ...shape.data, zodError, reason: errorReasonOf(error) } };
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

/**
 * The SPEC §1 verification gate: a confirmed email or an SMS-verified phone number.
 * Read from the session, which is loaded fresh on every request.
 */
export const requireVerifiedContact = t.middleware(({ ctx, next }) => {
  const user = ctx.session?.user;
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue." });
  if (!hasVerifiedContact(user)) {
    throw reasonError(
      "FORBIDDEN",
      VERIFICATION_REQUIRED_MESSAGE,
      API_ERROR_REASONS.VERIFICATION_REQUIRED,
    );
  }
  return next();
});

/**
 * Signed in with a verified contact. Use it for every booking, payment, messaging,
 * quote-request and business procedure; browsing, saving and onboarding stay on
 * `protectedProcedure` (SPEC §1).
 */
export const verifiedProcedure = protectedProcedure.use(requireVerifiedContact);

export const businessIdInput = z.object({ businessId: z.uuid() });

/**
 * Procedures scoped to one business: takes `{ businessId }` input (extend it with more
 * `.input()` fields as needed), checks the caller has a verified contact and is an active
 * member with one of `roles`, and adds `ctx.business` and `ctx.membership`. Non-members
 * get NOT_FOUND so a business id can't be probed; members without the role get FORBIDDEN.
 */
export function businessMemberProcedure(
  roles: readonly BusinessMemberRole[] = BUSINESS_MEMBER_ROLES,
) {
  return verifiedProcedure.input(businessIdInput).use(async ({ ctx, input, next }) => {
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
