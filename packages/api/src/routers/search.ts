import {
  approximateLocation,
  boundingBox,
  CANCELLATION_POLICIES,
  formatDistanceKm,
  haversineKm,
  isWithinBounds,
  type LatLng,
  LISTING_ABOUT_MIN_LENGTH,
  MIN_RATING_FILTER,
  OUTSIDE_LAUNCH_REGION_MESSAGE,
  type RatingSummary,
  rankResults,
  SEARCH_PAGE_SIZE,
  SERVICE_RADIUS_MAX_KM,
  type SearchQuery,
  searchInputSchema,
  serviceAreaDescription,
} from "@nevile/core";
import {
  and,
  asc,
  avg,
  type Business,
  between,
  businesses,
  businessMembers,
  businessPhotos,
  count,
  type DbExecutor,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  reviews,
  type Service,
  type ServiceArea,
  serviceAreas,
  serviceCategories,
  services,
  sql,
  user,
} from "@nevile/db";
import type { MediaStorage } from "@nevile/storage";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isInstantBookable, servicePrice } from "../listing-state.ts";
import { lookupPostalArea } from "../postal.ts";
import { publicProcedure, router } from "../trpc.ts";

/** Where the customer is, as far as search is concerned (SPEC §18). */
export type SearchLocation =
  | {
      kind: "postal";
      requested: string;
      code: string;
      placeName: string;
      approximate: boolean;
    }
  | { kind: "near" }
  /** No usable location: all of Nova Scotia, without distances. */
  | { kind: "province"; reason: "none" | "unknown_area" | "outside_bounds"; requested?: string }
  /** A postal code outside the launch region: no results. */
  | { kind: "outside"; requested: string; message: string };

const MIN_ABOUT_SQL = sql`char_length(btrim(coalesce(${businesses.description}, ''))) >= ${LISTING_ABOUT_MIN_LENGTH}`;

/** Published, not suspended, ready to be found (SPEC §18). */
const isListed = and(
  isNotNull(businesses.publishedAt),
  isNull(businesses.suspendedAt),
  MIN_ABOUT_SQL,
);

async function resolveLocation(
  db: DbExecutor,
  query: SearchQuery,
): Promise<{ location: SearchLocation; point: LatLng | null }> {
  if (query.near) {
    return isWithinBounds(query.near)
      ? { location: { kind: "near" }, point: query.near }
      : { location: { kind: "province", reason: "outside_bounds" }, point: null };
  }
  if (!query.postalCode) return { location: { kind: "province", reason: "none" }, point: null };
  const lookup = await lookupPostalArea(db, query.postalCode);
  switch (lookup.kind) {
    case "invalid":
      throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a postal code like B3H 1A1." });
    case "outside":
      return {
        location: {
          kind: "outside",
          requested: lookup.requested,
          message: OUTSIDE_LAUNCH_REGION_MESSAGE,
        },
        point: null,
      };
    case "unknown":
      return {
        location: { kind: "province", reason: "unknown_area", requested: lookup.requested },
        point: null,
      };
    case "found":
      return {
        location: {
          kind: "postal",
          requested: lookup.area.requested,
          code: lookup.area.code,
          placeName: lookup.area.placeName,
          approximate: lookup.area.approximate,
        },
        point: lookup.area.point,
      };
  }
}

/** Average stars and count from customers' reviews, per business (SPEC §9). */
async function ratingsFor(
  db: DbExecutor,
  businessIds: readonly string[],
): Promise<Map<string, RatingSummary>> {
  if (businessIds.length === 0) return new Map();
  const rows = await db
    .select({ businessId: reviews.businessId, average: avg(reviews.stars), n: count() })
    .from(reviews)
    .where(and(inArray(reviews.businessId, [...businessIds]), eq(reviews.raterRole, "customer")))
    .groupBy(reviews.businessId);
  return new Map(
    rows.map((row) => [row.businessId, { average: Number(row.average ?? 0), count: row.n }]),
  );
}

/** One decimal, as shown next to the stars ("4.8"). */
function displayRating(rating: RatingSummary | undefined) {
  return rating && rating.count > 0
    ? { average: Math.round(rating.average * 10) / 10, count: rating.count }
    : null;
}

/**
 * The service a result shows: the cheapest fixed price, else the lowest "from" price,
 * else the first quote service.
 */
function representative(candidates: readonly Service[]): Service | undefined {
  const fixed = candidates
    .filter((service) => service.pricingType === "fixed")
    .sort((a, b) => (a.priceCents ?? 0) - (b.priceCents ?? 0));
  if (fixed[0]) return fixed[0];
  return [...candidates].sort(
    (a, b) =>
      (a.fromPriceCents ?? Number.MAX_SAFE_INTEGER) - (b.fromPriceCents ?? Number.MAX_SAFE_INTEGER),
  )[0];
}

function badgesOf(business: Business, instantBook: boolean) {
  return {
    verified: business.verifiedInsuranceAt !== null,
    // The Pro boost in "Best match" is always disclosed by this badge (SPEC §8, §18).
    pro: business.plan === "pro",
    instantBook,
  };
}

function logoUrl(storage: MediaStorage, business: Business): string | null {
  return business.logoKey ? storage.publicUrl(business.logoKey) : null;
}

async function runSearch(db: DbExecutor, storage: MediaStorage, query: SearchQuery) {
  const { location, point } = await resolveLocation(db, query);
  const empty = { location, results: [], total: 0, page: query.page, pageSize: SEARCH_PAGE_SIZE };
  if (location.kind === "outside") return { ...empty, hasMore: false };

  // Coarse prefilter: any area that could reach the customer has its centre within the
  // largest radius; the exact great-circle check follows.
  const box = point ? boundingBox(point, SERVICE_RADIUS_MAX_KM) : null;
  const rows = await db
    .select({ business: businesses, area: serviceAreas })
    .from(businesses)
    .innerJoin(serviceAreas, eq(serviceAreas.businessId, businesses.id))
    .where(
      and(
        isListed,
        box ? between(serviceAreas.lat, box.minLat, box.maxLat) : undefined,
        box ? between(serviceAreas.lng, box.minLng, box.maxLng) : undefined,
        query.verified ? isNotNull(businesses.verifiedInsuranceAt) : undefined,
        query.pro ? eq(businesses.plan, "pro") : undefined,
      ),
    );

  const reachable = rows
    .map((row) => ({
      ...row,
      distanceKm: point ? haversineKm(point, row.area) : null,
    }))
    .filter((row) => row.distanceKm === null || row.distanceKm <= row.area.radiusKm);
  if (reachable.length === 0) return { ...empty, hasMore: false };

  const ids = reachable.map((row) => row.business.id);
  const serviceRows = await db
    .select({ service: services, categorySlug: serviceCategories.slug })
    .from(services)
    .innerJoin(serviceCategories, eq(serviceCategories.id, services.categoryId))
    .where(
      and(
        inArray(services.businessId, ids),
        eq(services.active, true),
        eq(serviceCategories.active, true),
        query.category ? eq(serviceCategories.slug, query.category) : undefined,
      ),
    );
  const servicesByBusiness = new Map<string, Array<{ service: Service; categorySlug: string }>>();
  for (const row of serviceRows) {
    const list = servicesByBusiness.get(row.service.businessId) ?? [];
    list.push(row);
    servicesByBusiness.set(row.service.businessId, list);
  }
  const ratings = await ratingsFor(db, ids);

  const candidates = reachable.flatMap(({ business, area, distanceKm }) => {
    const matching = servicesByBusiness.get(business.id) ?? [];
    if (matching.length === 0) return [];
    const instantServices = matching.filter(({ service }) => isInstantBookable(business, service));
    const pool = query.instantBook ? instantServices : matching;
    const shown = representative(pool.map(({ service }) => service));
    if (!shown) return [];
    const rating = ratings.get(business.id) ?? null;
    if (query.topRated && !(rating && rating.average >= MIN_RATING_FILTER)) return [];
    const shownCategory = matching.find(({ service }) => service.id === shown.id)?.categorySlug;
    return [
      {
        id: business.id,
        name: business.name,
        distanceKm,
        radiusKm: area.radiusKm,
        rating,
        isPro: business.plan === "pro",
        business,
        area,
        shown,
        shownCategory: shownCategory ?? "",
        serviceCount: matching.length,
        instantBook: instantServices.length > 0,
      },
    ];
  });

  const ranked = rankResults(candidates, query.sort);
  const start = (query.page - 1) * SEARCH_PAGE_SIZE;
  const pageItems = ranked.slice(start, start + SEARCH_PAGE_SIZE);
  return {
    location,
    total: ranked.length,
    page: query.page,
    pageSize: SEARCH_PAGE_SIZE,
    hasMore: start + SEARCH_PAGE_SIZE < ranked.length,
    results: pageItems.map((item) => ({
      id: item.business.id,
      slug: item.business.slug,
      name: item.business.name,
      logoUrl: logoUrl(storage, item.business),
      badges: badgesOf(item.business, item.instantBook),
      rating: displayRating(item.rating ?? undefined),
      service: {
        title: item.shown.title,
        categorySlug: item.shownCategory,
        priceText: servicePrice(item.shown),
      },
      serviceCount: item.serviceCount,
      distanceKm: item.distanceKm === null ? null : Math.round(item.distanceKm * 10) / 10,
      distanceText: item.distanceKm === null ? null : formatDistanceKm(item.distanceKm),
      cancellationPolicy: CANCELLATION_POLICIES[item.business.cancellationPolicy].label,
      areaText: serviceAreaDescription(item.area.radiusKm, item.area.label),
      // About 1 km off the real base, so a sole operator's home is never shown (SPEC §18).
      pin: approximateLocation(item.area),
    })),
  };
}

const PROFILE_REVIEW_LIMIT = 10;

/** "Maya T." — first name and last initial only. */
function reviewerName(name: string | null): string {
  if (!name) return "Former customer";
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : (first ?? "Customer");
}

async function isMember(db: DbExecutor, businessId: string, userId: string | undefined) {
  if (!userId) return false;
  const [row] = await db
    .select({ id: businessMembers.id })
    .from(businessMembers)
    .where(
      and(
        eq(businessMembers.businessId, businessId),
        eq(businessMembers.userId, userId),
        eq(businessMembers.active, true),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export const searchRouter = router({
  /** Public search (SPEC §18). Never stores the customer's location. */
  query: publicProcedure
    .input(searchInputSchema)
    .query(({ ctx, input }) => runSearch(ctx.db, ctx.storage, input)),

  /** Where a postal code puts the customer, for "Showing pros near …". */
  area: publicProcedure
    .input(z.object({ postalCode: z.string().trim().max(10) }))
    .query(async ({ ctx, input }) => {
      const lookup = await lookupPostalArea(ctx.db, input.postalCode);
      if (lookup.kind !== "found") return lookup;
      const { area } = lookup;
      return {
        kind: "found" as const,
        requested: area.requested,
        code: area.code,
        placeName: area.placeName,
        approximate: area.approximate,
        // The area's centre (public data), e.g. to start a service-area pin from.
        center: area.point,
      };
    }),

  /**
   * A business's public page (`/pros/<slug>`). Unpublished or suspended businesses are
   * NOT_FOUND, except to their own members, who get a preview.
   */
  profile: publicProcedure
    .input(z.object({ slug: z.string().trim().min(1).max(80) }))
    .query(async ({ ctx, input }) => {
      const [business] = await ctx.db
        .select()
        .from(businesses)
        .where(eq(businesses.slug, input.slug.toLowerCase()))
        .limit(1);
      const notFound = new TRPCError({ code: "NOT_FOUND", message: "We couldn't find that pro." });
      if (!business) throw notFound;
      const listed = business.publishedAt !== null && business.suspendedAt === null;
      const preview = !listed && (await isMember(ctx.db, business.id, ctx.session?.user.id));
      if (!listed && !preview) throw notFound;

      const [area] = await ctx.db
        .select()
        .from(serviceAreas)
        .where(eq(serviceAreas.businessId, business.id))
        .limit(1);
      const serviceRows = await ctx.db
        .select({
          service: services,
          categorySlug: serviceCategories.slug,
          categoryName: serviceCategories.name,
          categoryOrder: serviceCategories.sortOrder,
        })
        .from(services)
        .innerJoin(serviceCategories, eq(serviceCategories.id, services.categoryId))
        .where(
          and(
            eq(services.businessId, business.id),
            eq(services.active, true),
            eq(serviceCategories.active, true),
          ),
        )
        .orderBy(asc(serviceCategories.sortOrder), asc(services.createdAt));
      const photos = await ctx.db
        .select()
        .from(businessPhotos)
        .where(eq(businessPhotos.businessId, business.id))
        .orderBy(asc(businessPhotos.sortOrder), asc(businessPhotos.createdAt));
      const rating = (await ratingsFor(ctx.db, [business.id])).get(business.id);
      const recentReviews = await ctx.db
        .select({
          id: reviews.id,
          stars: reviews.stars,
          comment: reviews.comment,
          reply: reviews.reply,
          createdAt: reviews.createdAt,
          raterName: user.name,
        })
        .from(reviews)
        .leftJoin(user, eq(user.id, reviews.raterUserId))
        .where(and(eq(reviews.businessId, business.id), eq(reviews.raterRole, "customer")))
        .orderBy(desc(reviews.createdAt))
        .limit(PROFILE_REVIEW_LIMIT);

      const instantBook = serviceRows.some(({ service }) => isInstantBookable(business, service));
      return {
        id: business.id,
        slug: business.slug,
        name: business.name,
        about: business.description ?? "",
        logoUrl: logoUrl(ctx.storage, business),
        badges: badgesOf(business, instantBook),
        rating: displayRating(rating),
        memberSince: business.createdAt,
        cancellationPolicy: {
          id: business.cancellationPolicy,
          label: CANCELLATION_POLICIES[business.cancellationPolicy].label,
          description: CANCELLATION_POLICIES[business.cancellationPolicy].description,
        },
        area: area ? publicArea(area) : null,
        services: serviceRows.map(({ service, categorySlug, categoryName }) => ({
          id: service.id,
          categorySlug,
          categoryName,
          title: service.title,
          description: service.description ?? "",
          priceText: servicePrice(service),
          durationMinutes: service.durationMinutes,
          instantBook: isInstantBookable(business, service),
        })),
        photos: photos.map((photo) => ({
          id: photo.id,
          url: ctx.storage.publicUrl(photo.storageKey),
          width: photo.width,
          height: photo.height,
          altText: photo.altText,
        })),
        reviews: recentReviews.map((review) => ({
          id: review.id,
          stars: review.stars,
          comment: review.comment,
          reply: review.reply,
          createdAt: review.createdAt,
          author: reviewerName(review.raterName),
        })),
        /** True when a member is looking at their unpublished page. */
        preview,
      };
    }),
});

function publicArea(area: ServiceArea) {
  return {
    radiusKm: area.radiusKm,
    description: serviceAreaDescription(area.radiusKm, area.label),
    // Rounded, like search pins: the map shows the area, not the base address.
    center: approximateLocation(area),
  };
}
