import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { businesses } from "./businesses.ts";
import { createdAt, id, latitudeCheck, longitudeCheck, updatedAt } from "./columns.ts";
import { province } from "./enums.ts";

/** Forward sortation area, e.g. `B3H` (the first half of a postal code). */
export const POSTAL_AREA_PATTERN = "^[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z]$";

/**
 * Work photos on a business's public page (SPEC §18). Files are re-encoded on upload, so
 * `storage_key` always points at a metadata-free WebP; the original is never stored.
 */
export const businessPhotos = pgTable(
  "business_photos",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull().unique(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    altText: text("alt_text").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("business_photos_business_sort_idx").on(t.businessId, t.sortOrder),
    check("business_photos_dimensions", sql`${t.width} > 0 AND ${t.height} > 0`),
    check("business_photos_alt_text_length", sql`char_length(${t.altText}) <= 160`),
  ],
);

/**
 * Postal code areas and their centre points, used to place customers for search
 * (SPEC §18). Production data comes from Statistics Canada's FSA boundary file; rows
 * seeded from the starter list are `approximate`.
 */
export const postalAreas = pgTable(
  "postal_areas",
  {
    code: text("code").primaryKey(),
    province: province("province").notNull(),
    placeName: text("place_name").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    approximate: boolean("approximate").notNull().default(true),
    source: text("source").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("postal_areas_code_format", sql`${t.code} ~ ${sql.raw(`'${POSTAL_AREA_PATTERN}'`)}`),
    latitudeCheck("postal_areas", t.lat),
    longitudeCheck("postal_areas", t.lng),
    index("postal_areas_lat_lng_idx").on(t.lat, t.lng),
  ],
);
