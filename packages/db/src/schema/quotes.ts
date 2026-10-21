import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { businesses } from "./businesses.ts";
import { services } from "./catalog.ts";
import { cents, id, nonNegative, timestamps, tstz } from "./columns.ts";
import { addresses } from "./customers.ts";
import { bookingKind, quoteRequestStatus, quoteStatus } from "./enums.ts";

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
    index("quote_requests_business_status_created_idx").on(t.businessId, t.status, t.createdAt),
    index("quote_requests_customer_created_idx").on(t.customerId, t.createdAt),
    index("quote_requests_open_expires_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} IN ('open', 'quoted')`),
    index("quote_requests_service_id_idx").on(t.serviceId),
    index("quote_requests_address_id_idx").on(t.addressId),
  ],
);

/** A business's priced reply. Expires 7 days after it is sent (SPEC §3). */
export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    quoteRequestId: uuid("quote_request_id")
      .notNull()
      .references(() => quoteRequests.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    priceCents: cents("price_cents").notNull(),
    proposedStart: tstz("proposed_start"),
    durationMinutes: integer("duration_minutes"),
    message: text("message"),
    status: quoteStatus("status").notNull().default("pending"),
    expiresAt: tstz("expires_at").notNull(),
    respondedAt: tstz("responded_at"),
    ...timestamps(),
  },
  (t) => [
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
  ],
);
