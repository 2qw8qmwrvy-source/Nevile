import { hasVerifiedContact } from "@nevile/auth";
import {
  LISTING_REQUIREMENTS,
  type ListingRequirement,
  listingReadiness,
  type PricingType,
  priceSummary,
  serviceAreaDescription,
} from "@nevile/core";
import {
  and,
  asc,
  type Business,
  type BusinessMemberRole,
  businesses,
  businessPhotos,
  count,
  type DbExecutor,
  eq,
  type Service,
  serviceAreas,
  serviceCategories,
  services,
  user,
} from "@nevile/db";
import type { MediaStorage } from "@nevile/storage";
import { TRPCError } from "@trpc/server";

/** Roles that may edit a listing; crew can only view it (SPEC §18). */
export const LISTING_EDITOR_ROLES = ["owner", "manager"] as const satisfies BusinessMemberRole[];

/**
 * Runs a listing change in a transaction holding the business row lock, so concurrent
 * edits (two managers, a double click) apply one at a time and "published ⇒ ready" holds.
 */
export async function withListingLock<T>(
  db: DbExecutor,
  businessId: string,
  change: (tx: DbExecutor, business: Business) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const [business] = await tx
      .select()
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .for("update");
    if (!business) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found." });
    return change(tx, business);
  });
}

/** Active services in active categories: the ones customers can find. */
const listedService = (businessId: string) =>
  and(
    eq(services.businessId, businessId),
    eq(services.active, true),
    eq(serviceCategories.active, true),
  );

export async function readinessOf(db: DbExecutor, business: Business) {
  const [owner] = await db
    .select({
      email: user.email,
      emailVerified: user.emailVerified,
      phoneNumber: user.phoneNumber,
      phoneNumberVerified: user.phoneNumberVerified,
    })
    .from(user)
    .where(eq(user.id, business.ownerUserId))
    .limit(1);
  const [area] = await db
    .select({ id: serviceAreas.id })
    .from(serviceAreas)
    .where(eq(serviceAreas.businessId, business.id))
    .limit(1);
  const [active] = await db
    .select({ n: count() })
    .from(services)
    .innerJoin(serviceCategories, eq(serviceCategories.id, services.categoryId))
    .where(listedService(business.id));
  return listingReadiness({
    verified: owner ? hasVerifiedContact(owner) : false,
    suspended: business.suspendedAt !== null,
    name: business.name,
    description: business.description,
    hasServiceArea: area !== undefined,
    activeServices: active?.n ?? 0,
  });
}

/**
 * Keeps "published ⇒ ready" (SPEC §18): after a change, a published listing that is no
 * longer ready is unpublished. Returns true when that happened.
 */
export async function unpublishIfNotReady(tx: DbExecutor, businessId: string): Promise<boolean> {
  const [business] = await tx.select().from(businesses).where(eq(businesses.id, businessId));
  if (!business?.publishedAt) return false;
  const { ready } = await readinessOf(tx, business);
  if (ready) return false;
  await tx.update(businesses).set({ publishedAt: null }).where(eq(businesses.id, businessId));
  return true;
}

export function missingWithLabels(missing: readonly ListingRequirement[]) {
  return missing.map((key) => ({ key, label: LISTING_REQUIREMENTS[key] }));
}

/** Price text for a service row ("$60 / visit", "Quote · from $45"). */
export function servicePrice(
  service: Pick<Service, "pricingType" | "priceCents" | "fromPriceCents">,
) {
  return service.pricingType === "fixed"
    ? priceSummary({ pricingType: "fixed", priceCents: service.priceCents ?? 0 })
    : priceSummary({ pricingType: "quote", fromPriceCents: service.fromPriceCents });
}

/**
 * Whether a service can be booked instantly: fixed price, the business has Instant Book on,
 * and the service doesn't opt out (`instant_book = false`; null follows the business).
 */
export function isInstantBookable(
  business: Pick<Business, "instantBook">,
  service: { pricingType: PricingType; instantBook: boolean | null },
): boolean {
  return business.instantBook && service.pricingType === "fixed" && service.instantBook !== false;
}

/** Everything the business dashboard shows about a listing. */
export async function listingView(
  db: DbExecutor,
  storage: MediaStorage,
  business: Business,
  role: BusinessMemberRole,
) {
  const canEdit = (LISTING_EDITOR_ROLES as readonly string[]).includes(role);
  const [area] = await db
    .select()
    .from(serviceAreas)
    .where(eq(serviceAreas.businessId, business.id))
    .limit(1);
  const serviceRows = await db
    .select({
      service: services,
      categorySlug: serviceCategories.slug,
      categoryName: serviceCategories.name,
    })
    .from(services)
    .innerJoin(serviceCategories, eq(serviceCategories.id, services.categoryId))
    .where(eq(services.businessId, business.id))
    .orderBy(asc(services.createdAt), asc(services.id));
  const photos = await db
    .select()
    .from(businessPhotos)
    .where(eq(businessPhotos.businessId, business.id))
    .orderBy(asc(businessPhotos.sortOrder), asc(businessPhotos.createdAt));
  const readiness = await readinessOf(db, business);

  return {
    business: {
      id: business.id,
      name: business.name,
      slug: business.slug,
      description: business.description ?? "",
      // Tax identifiers are for owners and managers only.
      gstHstNumber: canEdit ? (business.gstHstNumber ?? "") : null,
      cancellationPolicy: business.cancellationPolicy,
      instantBook: business.instantBook,
      acceptsQuoteRequests: business.acceptsQuoteRequests,
      plan: business.plan,
      verified: business.verifiedInsuranceAt !== null,
      suspended: business.suspendedAt !== null,
      logoUrl: business.logoKey ? storage.publicUrl(business.logoKey) : null,
      publishedAt: business.publishedAt,
    },
    role,
    canEdit,
    serviceArea: area
      ? {
          lat: area.lat,
          lng: area.lng,
          radiusKm: area.radiusKm,
          label: area.label,
          description: serviceAreaDescription(area.radiusKm, area.label),
        }
      : null,
    services: serviceRows.map(({ service, categorySlug, categoryName }) => ({
      id: service.id,
      categorySlug,
      categoryName,
      title: service.title,
      description: service.description ?? "",
      pricingType: service.pricingType,
      priceCents: service.priceCents,
      fromPriceCents: service.fromPriceCents,
      priceText: servicePrice(service),
      durationMinutes: service.durationMinutes,
      instantBook: service.pricingType === "fixed" && service.instantBook !== false,
      active: service.active,
      recurrenceFrequencies: service.recurrenceFrequencies,
    })),
    photos: photos.map((photo) => ({
      id: photo.id,
      url: storage.publicUrl(photo.storageKey),
      width: photo.width,
      height: photo.height,
      altText: photo.altText,
    })),
    readiness: { ready: readiness.ready, missing: missingWithLabels(readiness.missing) },
  };
}
export type ListingView = Awaited<ReturnType<typeof listingView>>;
