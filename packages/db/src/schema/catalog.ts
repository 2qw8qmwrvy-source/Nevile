import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { businesses } from "./businesses.ts";
import { cents, id, nonNegative, positive, slugCheck, timestamps, tstz } from "./columns.ts";
import {
  approvalStatus,
  bookingKind,
  pricingType,
  recurrenceFrequency,
  seasonBilling,
  snowPriceBasis,
} from "./enums.ts";

/** Nevile-managed category list (SPEC §3); seeded from `DEFAULT_CATEGORIES`. */
export const serviceCategories = pgTable(
  "service_categories",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    slugCheck("service_categories", t.slug),
    index("service_categories_active_sort_idx").on(t.active, t.sortOrder),
  ],
);

/** A business asks for a category that is not on the list; an admin decides. */
export const categoryRequests = pgTable(
  "category_requests",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    requestedByUserId: text("requested_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    proposedName: text("proposed_name").notNull(),
    description: text("description"),
    status: approvalStatus("status").notNull().default("pending"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: tstz("reviewed_at"),
    reviewNote: text("review_note"),
    // Category created (or matched) when the request was approved.
    categoryId: uuid("category_id").references(() => serviceCategories.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (t) => [
    index("category_requests_business_id_idx").on(t.businessId),
    index("category_requests_status_created_idx").on(t.status, t.createdAt),
    uniqueIndex("category_requests_one_pending_name_uidx")
      .on(t.businessId, sql`lower(${t.proposedName})`)
      .where(sql`${t.status} = 'pending'`),
    check(
      "category_requests_reviewed",
      sql`${t.status} = 'pending' OR ${t.reviewedAt} IS NOT NULL`,
    ),
    check(
      "category_requests_approved_category",
      sql`${t.status} <> 'approved' OR ${t.categoryId} IS NOT NULL`,
    ),
  ],
);

export const services = pgTable(
  "services",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => serviceCategories.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    pricingType: pricingType("pricing_type").notNull(),
    // Fixed price per visit (required for `fixed`, absent for `quote`).
    priceCents: cents("price_cents"),
    // Optional "from $X" hint shown on quote-only services.
    fromPriceCents: cents("from_price_cents"),
    durationMinutes: integer("duration_minutes").notNull(),
    // Per-service override of `businesses.instant_book`; null inherits the business setting.
    instantBook: boolean("instant_book"),
    // Booking kinds the business offers for this service.
    bookingKinds: bookingKind("booking_kinds").array().notNull().default(["one_off"]),
    // How often a fixed-price service can repeat (SPEC §21); empty: one-off only.
    recurrenceFrequencies: recurrenceFrequency("recurrence_frequencies")
      .array()
      .notNull()
      .default([]),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index("services_business_id_idx").on(t.businessId),
    index("services_category_active_idx").on(t.categoryId, t.active),
    nonNegative("services", t.priceCents),
    nonNegative("services", t.fromPriceCents),
    check(
      "services_price_matches_pricing_type",
      sql`(${t.pricingType} = 'fixed' AND ${t.priceCents} IS NOT NULL) OR (${t.pricingType} = 'quote' AND ${t.priceCents} IS NULL)`,
    ),
    check(
      "services_from_price_quote_only",
      sql`${t.pricingType} = 'quote' OR ${t.fromPriceCents} IS NULL`,
    ),
    check(
      "services_instant_book_fixed_only",
      sql`${t.pricingType} = 'fixed' OR ${t.instantBook} IS NOT TRUE`,
    ),
    check("services_duration_minutes_range", sql`${t.durationMinutes} BETWEEN 1 AND 1440`),
    check("services_booking_kinds_not_empty", sql`cardinality(${t.bookingKinds}) > 0`),
    check(
      "services_recurring_fixed_only",
      sql`${t.pricingType} = 'fixed' OR cardinality(${t.recurrenceFrequencies}) = 0`,
    ),
  ],
);

/**
 * A service listed as a seasonal snow contract (SPEC §21): the terms customers sign up
 * to. The service's `price_cents` repeats `price_cents` here (per visit or per season).
 */
export const serviceContractTerms = pgTable(
  "service_contract_terms",
  {
    serviceId: uuid("service_id")
      .primaryKey()
      .references(() => services.id, { onDelete: "cascade" }),
    triggerCm: integer("trigger_cm").notNull(),
    seasonStart: date("season_start", { mode: "string" }).notNull(),
    seasonEnd: date("season_end", { mode: "string" }).notNull(),
    pricing: snowPriceBasis("pricing").notNull(),
    priceCents: cents("price_cents").notNull(),
    // How a season price can be paid; null for per-visit pricing.
    seasonBilling: seasonBilling("season_billing"),
    // How many customers the contract can take.
    spots: integer("spots").notNull(),
    ...timestamps(),
  },
  (t) => [
    positive("service_contract_terms", t.triggerCm),
    positive("service_contract_terms", t.priceCents),
    positive("service_contract_terms", t.spots),
    check("service_contract_terms_season_range", sql`${t.seasonEnd} > ${t.seasonStart}`),
    check(
      "service_contract_terms_billing",
      sql`(${t.pricing} = 'season') = (${t.seasonBilling} IS NOT NULL)`,
    ),
  ],
);
