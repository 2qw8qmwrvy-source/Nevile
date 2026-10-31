import {
  businessProfileSchema,
  photoAltSchema,
  serviceAreaInputSchema,
  serviceInputSchema,
  snowContractListingSchema,
} from "@nevile/core";
import {
  and,
  businesses,
  businessPhotos,
  eq,
  serviceAreas,
  serviceCategories,
  services,
} from "@nevile/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  LISTING_EDITOR_ROLES,
  listingView,
  missingWithLabels,
  readinessOf,
  unpublishIfNotReady,
  withListingLock,
} from "../listing-state.ts";
import { deleteQuietly } from "../media.ts";
import { isContractService } from "../ongoing/contract-terms.ts";
import { setContractTerms } from "../ongoing/snow.ts";
import { nearestPlaceName } from "../postal.ts";
import { businessMemberProcedure, router } from "../trpc.ts";

const viewer = businessMemberProcedure();
const editor = businessMemberProcedure(LISTING_EDITOR_ROLES);

const serviceIdInput = z.object({ serviceId: z.uuid() });
const photoIdInput = z.object({ photoId: z.uuid() });

/** Postgres foreign-key violation (a booking or quote still points at the row). */
function isForeignKeyViolation(error: unknown): boolean {
  for (let current = error; current; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: string }).code === "23503") return true;
  }
  return false;
}

async function categoryIdFor(db: Parameters<typeof listingView>[0], slug: string): Promise<string> {
  const [category] = await db
    .select({ id: serviceCategories.id })
    .from(serviceCategories)
    .where(and(eq(serviceCategories.slug, slug), eq(serviceCategories.active, true)))
    .limit(1);
  if (!category) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That category isn't available." });
  }
  return category.id;
}

/**
 * Stored form of a service's Instant Book choice: null follows the business setting,
 * false opts the service out. Quote services are never instant (SPEC §4).
 */
function serviceValues(input: z.output<typeof serviceInputSchema>, categoryId: string) {
  return {
    categoryId,
    title: input.title,
    description: input.description || null,
    pricingType: input.pricingType,
    priceCents: input.pricingType === "fixed" ? input.priceCents : null,
    fromPriceCents: input.pricingType === "quote" ? input.fromPriceCents : null,
    durationMinutes: input.durationMinutes,
    instantBook: input.pricingType === "fixed" && !input.instantBook ? false : null,
    active: input.active,
    recurrenceFrequencies: input.pricingType === "fixed" ? input.recurrenceFrequencies : [],
  };
}

/**
 * Listing management from business mode (SPEC §18). Every member can view; owners and
 * managers edit. Each change runs under the business row lock and unpublishes the listing
 * if it is no longer ready, which the result reports as `unpublished`.
 */
export const listingRouter = router({
  get: viewer.query(({ ctx }) =>
    listingView(ctx.db, ctx.storage, ctx.business, ctx.membership.role),
  ),

  updateProfile: editor.input(businessProfileSchema).mutation(async ({ ctx, input }) => {
    const unpublished = await withListingLock(ctx.db, ctx.business.id, async (tx) => {
      // The slug stays as it was, so shared links keep working after a rename.
      await tx
        .update(businesses)
        .set({
          name: input.name,
          description: input.description || null,
          gstHstNumber: input.gstHstNumber,
          taxRegistered: input.gstHstNumber !== null,
          cancellationPolicy: input.cancellationPolicy,
          instantBook: input.instantBook,
          ...(input.acceptsQuoteRequests === undefined
            ? {}
            : { acceptsQuoteRequests: input.acceptsQuoteRequests }),
        })
        .where(eq(businesses.id, ctx.business.id));
      return unpublishIfNotReady(tx, ctx.business.id);
    });
    return { unpublished };
  }),

  setServiceArea: editor.input(serviceAreaInputSchema).mutation(async ({ ctx, input }) => {
    const label = await nearestPlaceName(ctx.db, input.center);
    await withListingLock(ctx.db, ctx.business.id, async (tx) => {
      await tx
        .insert(serviceAreas)
        .values({
          businessId: ctx.business.id,
          lat: input.center.lat,
          lng: input.center.lng,
          radiusKm: input.radiusKm,
          label,
        })
        .onConflictDoUpdate({
          target: serviceAreas.businessId,
          set: { lat: input.center.lat, lng: input.center.lng, radiusKm: input.radiusKm, label },
        });
    });
    return { label };
  }),

  createService: editor.input(serviceInputSchema).mutation(async ({ ctx, input }) => {
    const categoryId = await categoryIdFor(ctx.db, input.categorySlug);
    return withListingLock(ctx.db, ctx.business.id, async (tx) => {
      const [row] = await tx
        .insert(services)
        .values({ businessId: ctx.business.id, ...serviceValues(input, categoryId) })
        .returning({ id: services.id });
      return { id: row?.id ?? "", unpublished: await unpublishIfNotReady(tx, ctx.business.id) };
    });
  }),

  updateService: editor
    .input(serviceIdInput.extend({ service: serviceInputSchema }))
    .mutation(async ({ ctx, input }) => {
      const categoryId = await categoryIdFor(ctx.db, input.service.categorySlug);
      if (
        input.service.recurrenceFrequencies.length > 0 &&
        (await isContractService(ctx.db, input.serviceId))
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A seasonal contract can't also be booked as recurring visits.",
        });
      }
      const unpublished = await withListingLock(ctx.db, ctx.business.id, async (tx) => {
        const [row] = await tx
          .update(services)
          .set(serviceValues(input.service, categoryId))
          .where(and(eq(services.id, input.serviceId), eq(services.businessId, ctx.business.id)))
          .returning({ id: services.id });
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
        return unpublishIfNotReady(tx, ctx.business.id);
      });
      return { unpublished };
    }),

  deleteService: editor.input(serviceIdInput).mutation(async ({ ctx, input }) => {
    try {
      const unpublished = await withListingLock(ctx.db, ctx.business.id, async (tx) => {
        const [row] = await tx
          .delete(services)
          .where(and(eq(services.id, input.serviceId), eq(services.businessId, ctx.business.id)))
          .returning({ id: services.id });
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
        return unpublishIfNotReady(tx, ctx.business.id);
      });
      return { unpublished };
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This service has bookings or quotes. Turn it off instead of deleting it.",
        });
      }
      throw error;
    }
  }),

  /**
   * Lists a Snow & Ice Removal service as a seasonal contract (SPEC §21), or stops
   * offering it with `terms: null`. Signed contracts keep their own terms.
   */
  setContractTerms: editor
    .input(serviceIdInput.extend({ terms: snowContractListingSchema.nullable() }))
    .mutation(async ({ ctx, input }) => {
      await withListingLock(ctx.db, ctx.business.id, (tx) =>
        setContractTerms(tx, ctx.business.id, input.serviceId, input.terms),
      );
      return { ok: true as const };
    }),

  updatePhoto: editor
    .input(photoIdInput.extend({ altText: photoAltSchema }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(businessPhotos)
        .set({ altText: input.altText })
        .where(
          and(eq(businessPhotos.id, input.photoId), eq(businessPhotos.businessId, ctx.business.id)),
        )
        .returning({ id: businessPhotos.id });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Photo not found." });
      return { ok: true as const };
    }),

  /** `photoIds` lists every photo of the business, in the new order. */
  reorderPhotos: editor
    .input(z.object({ photoIds: z.array(z.uuid()).max(50) }))
    .mutation(async ({ ctx, input }) => {
      await withListingLock(ctx.db, ctx.business.id, async (tx) => {
        const current = await tx
          .select({ id: businessPhotos.id })
          .from(businessPhotos)
          .where(eq(businessPhotos.businessId, ctx.business.id));
        const wanted = new Set(input.photoIds);
        if (
          wanted.size !== input.photoIds.length ||
          wanted.size !== current.length ||
          current.some((photo) => !wanted.has(photo.id))
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Your photos changed in the meantime. Reload and try again.",
          });
        }
        for (const [index, id] of input.photoIds.entries()) {
          await tx
            .update(businessPhotos)
            .set({ sortOrder: index })
            .where(eq(businessPhotos.id, id));
        }
      });
      return { ok: true as const };
    }),

  deletePhoto: editor.input(photoIdInput).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .delete(businessPhotos)
      .where(
        and(eq(businessPhotos.id, input.photoId), eq(businessPhotos.businessId, ctx.business.id)),
      )
      .returning({ storageKey: businessPhotos.storageKey });
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Photo not found." });
    await deleteQuietly(ctx.storage, row.storageKey);
    return { ok: true as const };
  }),

  removeLogo: editor.mutation(async ({ ctx }) => {
    const key = await withListingLock(ctx.db, ctx.business.id, async (tx, business) => {
      if (!business.logoKey) return null;
      await tx.update(businesses).set({ logoKey: null }).where(eq(businesses.id, business.id));
      return business.logoKey;
    });
    if (key) await deleteQuietly(ctx.storage, key);
    return { ok: true as const };
  }),

  /** Lists the business in search, if it is ready (SPEC §18). */
  publish: editor.mutation(({ ctx }) =>
    withListingLock(ctx.db, ctx.business.id, async (tx, business) => {
      const readiness = await readinessOf(tx, business);
      if (!readiness.ready) {
        return { published: false as const, missing: missingWithLabels(readiness.missing) };
      }
      const publishedAt = business.publishedAt ?? new Date();
      await tx.update(businesses).set({ publishedAt }).where(eq(businesses.id, business.id));
      return { published: true as const, publishedAt };
    }),
  ),

  /** Hides the business from search straight away. */
  unpublish: editor.mutation(async ({ ctx }) => {
    await ctx.db
      .update(businesses)
      .set({ publishedAt: null })
      .where(eq(businesses.id, ctx.business.id));
    return { ok: true as const };
  }),
});
