import {
  isNsRegionId,
  type NsRegionId,
  nsRegion,
  PUBLIC_REGION_MIN_COMPLETED_JOBS,
  publicRegions,
  referralInputSchema,
  summarizeLedger,
} from "@nevile/core";
import {
  and,
  asc,
  communityFundLedger,
  communityPartnerMembers,
  communityPartners,
  communityReferrals,
  eq,
  serviceCategories,
  sql,
} from "@nevile/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  API_ERROR_REASONS,
  protectedProcedure,
  publicProcedure,
  reasonError,
  requireVerifiedContact,
  router,
} from "../trpc.ts";

/** A partner's referral (core's strict schema, so no extra personal details) and its partner. */
export const submitReferralInput = referralInputSchema.extend({ partnerId: z.uuid() });

export const NEIGHBOURS_DISABLED_MESSAGE =
  "Nevile Neighbours is launching soon. Referrals aren't open yet.";

/** Referrals while the program is switched on (SPEC §15), from verified partner staff. */
const neighboursProcedure = protectedProcedure
  .use(({ ctx, next }) => {
    if (!ctx.config.neighboursEnabled) {
      throw reasonError(
        "PRECONDITION_FAILED",
        NEIGHBOURS_DISABLED_MESSAGE,
        API_ERROR_REASONS.NEIGHBOURS_DISABLED,
      );
    }
    return next();
  })
  .use(requireVerifiedContact);

/** Postgres error code and constraint of a failed query, without its parameters or row. */
function dbErrorSummary(error: unknown): { code?: string; constraint?: string } {
  const source = (error as { cause?: unknown })?.cause ?? error;
  const { code, constraint } = (source ?? {}) as { code?: unknown; constraint?: unknown };
  return {
    ...(typeof code === "string" ? { code } : {}),
    ...(typeof constraint === "string" ? { constraint } : {}),
  };
}

export const communityRouter = router({
  /** Whether Nevile Neighbours is switched on; while off, pages say "launching soon". */
  status: publicProcedure.query(({ ctx }) => ({ enabled: ctx.config.neighboursEnabled })),

  /**
   * Public impact page (SPEC §15): fund totals from the append-only ledger, completed
   * referral jobs, and the regions with at least `regionThreshold` completed jobs. Only
   * aggregates: no names, addresses or per-referral data.
   */
  impact: publicProcedure.query(async ({ ctx }) => {
    const ledger = await ctx.db
      .select({
        kind: communityFundLedger.kind,
        totalCents: sql<string>`coalesce(sum(${communityFundLedger.amountCents}), 0)::text`,
      })
      .from(communityFundLedger)
      .groupBy(communityFundLedger.kind);
    const summary = summarizeLedger(
      ledger.map((row) => ({ kind: row.kind, amountCents: Number(row.totalCents) })),
    );

    const completed = await ctx.db
      .select({
        regionId: communityReferrals.regionId,
        jobs: sql<number>`count(*)::int`,
      })
      .from(communityReferrals)
      .where(eq(communityReferrals.status, "completed"))
      .groupBy(communityReferrals.regionId);
    const byRegion: Partial<Record<NsRegionId, number>> = {};
    let completedJobs = 0;
    for (const row of completed) {
      completedJobs += row.jobs;
      if (isNsRegionId(row.regionId)) byRegion[row.regionId] = row.jobs;
    }

    return {
      enabled: ctx.config.neighboursEnabled,
      ...summary,
      completedJobs,
      regions: publicRegions(byRegion),
      regionThreshold: PUBLIC_REGION_MIN_COMPLETED_JOBS,
    };
  }),

  /** Partner organizations the caller can submit referrals for. */
  myPartners: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: communityPartners.id,
        name: communityPartners.name,
        kind: communityPartners.kind,
        regionId: communityPartners.regionId,
        role: communityPartnerMembers.role,
      })
      .from(communityPartnerMembers)
      .innerJoin(communityPartners, eq(communityPartners.id, communityPartnerMembers.partnerId))
      .where(
        and(eq(communityPartnerMembers.userId, ctx.user.id), eq(communityPartners.active, true)),
      )
      .orderBy(asc(communityPartners.name));
    return rows.map((row) => ({
      ...row,
      regionName: isNsRegionId(row.regionId) ? nsRegion(row.regionId).name : null,
    }));
  }),

  /**
   * A partner's referral for a homeowner, queued for admin review. Only staff of an active
   * partner, with a verified contact, while the program is on. The contents are personal
   * information: never logged, not even in errors.
   */
  submitReferral: neighboursProcedure
    .input(submitReferralInput)
    .mutation(async ({ ctx, input }) => {
      const { partnerId, categorySlug, consentConfirmed: _consent, ...referral } = input;
      const [membership] = await ctx.db
        .select({ partnerId: communityPartners.id })
        .from(communityPartnerMembers)
        .innerJoin(communityPartners, eq(communityPartners.id, communityPartnerMembers.partnerId))
        .where(
          and(
            eq(communityPartnerMembers.partnerId, partnerId),
            eq(communityPartnerMembers.userId, ctx.user.id),
            eq(communityPartners.active, true),
          ),
        )
        .limit(1);
      // Same answer for "no such partner" and "not your partner", so ids can't be probed.
      if (!membership) throw new TRPCError({ code: "NOT_FOUND", message: "Partner not found." });

      const [category] = await ctx.db
        .select({ id: serviceCategories.id })
        .from(serviceCategories)
        .where(and(eq(serviceCategories.slug, categorySlug), eq(serviceCategories.active, true)))
        .limit(1);
      if (!category) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That service isn't available right now.",
        });
      }

      try {
        const [created] = await ctx.db
          .insert(communityReferrals)
          .values({
            ...referral,
            partnerId,
            submittedByUserId: ctx.user.id,
            categoryId: category.id,
            // The schema only accepts `consentConfirmed: true`.
            consentConfirmedAt: new Date(),
          })
          .returning({
            id: communityReferrals.id,
            status: communityReferrals.status,
            createdAt: communityReferrals.createdAt,
          });
        if (!created) throw new Error("insert returned no row");
        return created;
      } catch (error) {
        // Driver errors quote the query parameters and the failing row; keep them out of
        // logs and out of the error's cause.
        console.error("[community] could not save a referral", dbErrorSummary(error));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "We couldn't save this referral. Please try again.",
        });
      }
    }),
});
