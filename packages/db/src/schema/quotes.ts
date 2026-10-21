import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { businesses } from "./businesses.ts";
import { services } from "./catalog.ts";
import { cents, id, nonNegative, timestamps, tstz } from "./columns.ts";
import { addresses } from "./customers.ts";
import {
  bookingKind,
  quoteRequestStatus,
  quoteStatus,
  recurrenceFrequency,
  snowPriceBasis,
} from "./enums.ts";

/** "Request a quote": the customer describes the job; nothing is held on the calendar. */
export const quoteRequests = pgTable(
  "quote_requests",
  {
    id: id(),
    customerId: text("customer_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    addressId: uuid("address_id")
      .notNull()
      .references(() => addresses.id),
    kind: bookingKind("kind").notNull().default("one_off"),
    details: text("details").notNull(),
    // Local calendar dates (YYYY-MM-DD) the customer would prefer.
    preferredDays: date("preferred_days", { mode: "string" }).array().notNull().default([]),
    status: quoteRequestStatus("status").notNull().default("open"),
    expiresAt: tstz("expires_at").notNull(),
    ...timestamps(),
  },
  (t) => [
    // Target of the quotes (quote_request_id, kind) FK.
    unique("quote_requests_id_kind_unique").on(t.id, t.kind),
    index("quote_requests_business_status_created_idx").on(t.businessId, t.status, t.createdAt),
    index("quote_requests_customer_created_idx").on(t.customerId, t.createdAt),
    index("quote_requests_open_expires_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} IN ('open', 'quoted')`),
    index("quote_requests_service_id_idx").on(t.serviceId),
    index("quote_requests_address_id_idx").on(t.addressId),
  ],
);

/**
 * A business's priced reply. Expires 7 days after it is sent (SPEC §3). It carries every
 * agreed term, so accepting it creates the booking (and its `recurring_series` or
 * `snow_contracts` row) from stored terms only:
 * - one-off / on-demand: price per job, optional proposed start and duration;
 * - recurring: price per visit, first visit (`proposed_start`), duration, frequency and
 *   end of the series;
 * - snow contract: price per visit or per season (`price_basis`), snowfall trigger and
 *   season dates.
 * `kind` repeats the request's kind (composite FK) so the CHECKs can require the
 * matching terms.
 */
export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    quoteRequestId: uuid("quote_request_id")
      .notNull()
      .references(() => quoteRequests.id, { onDelete: "cascade" }),
    kind: bookingKind("kind").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    priceCents: cents("price_cents").notNull(),
    proposedStart: tstz("proposed_start"),
    durationMinutes: integer("duration_minutes"),
    // Recurring terms.
    frequency: recurrenceFrequency("frequency"),
    seriesEndsAt: tstz("series_ends_at"),
    // Snow-contract terms.
    priceBasis: snowPriceBasis("price_basis"),
    triggerCm: integer("trigger_cm"),
    seasonStart: date("season_start", { mode: "string" }),
    seasonEnd: date("season_end", { mode: "string" }),
    message: text("message"),
    status: quoteStatus("status").notNull().default("pending"),
    expiresAt: tstz("expires_at").notNull(),
    respondedAt: tstz("responded_at"),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "quotes_request_kind_fk",
      columns: [t.quoteRequestId, t.kind],
      foreignColumns: [quoteRequests.id, quoteRequests.kind],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    index("quotes_quote_request_id_idx").on(t.quoteRequestId),
    index("quotes_pending_expires_idx").on(t.expiresAt).where(sql`${t.status} = 'pending'`),
    uniqueIndex("quotes_one_pending_per_request_uidx")
      .on(t.quoteRequestId)
      .where(sql`${t.status} = 'pending'`),
    uniqueIndex("quotes_one_accepted_per_request_uidx")
      .on(t.quoteRequestId)
      .where(sql`${t.status} = 'accepted'`),
    nonNegative("quotes", t.priceCents),
    check("quotes_expires_after_created", sql`${t.expiresAt} > ${t.createdAt}`),
    check("quotes_duration_minutes_positive", sql`${t.durationMinutes} > 0`),
    check(
      "quotes_recurring_terms",
      sql`CASE WHEN ${t.kind} = 'recurring'
        THEN num_nonnulls(${t.proposedStart}, ${t.durationMinutes}, ${t.frequency}, ${t.seriesEndsAt}) = 4
          AND ${t.seriesEndsAt} > ${t.proposedStart}
        ELSE num_nonnulls(${t.frequency}, ${t.seriesEndsAt}) = 0 END`,
    ),
    check(
      "quotes_snow_terms",
      sql`CASE WHEN ${t.kind} = 'snow_contract'
        THEN num_nonnulls(${t.priceBasis}, ${t.triggerCm}, ${t.seasonStart}, ${t.seasonEnd}) = 4
          AND ${t.triggerCm} > 0 AND ${t.seasonEnd} > ${t.seasonStart}
        ELSE num_nonnulls(${t.priceBasis}, ${t.triggerCm}, ${t.seasonStart}, ${t.seasonEnd}) = 0 END`,
    ),
  ],
);
