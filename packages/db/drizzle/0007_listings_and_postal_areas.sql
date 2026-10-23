CREATE TABLE "business_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"alt_text" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_photos_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "business_photos_dimensions" CHECK ("business_photos"."width" > 0 AND "business_photos"."height" > 0),
	CONSTRAINT "business_photos_alt_text_length" CHECK (char_length("business_photos"."alt_text") <= 160)
);
--> statement-breakpoint
CREATE TABLE "postal_areas" (
	"code" text PRIMARY KEY NOT NULL,
	"province" "province" NOT NULL,
	"place_name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"approximate" boolean DEFAULT true NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "postal_areas_code_format" CHECK ("postal_areas"."code" ~ '^[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z]$'),
	CONSTRAINT "postal_areas_lat_range" CHECK ("postal_areas"."lat" BETWEEN -90 AND 90),
	CONSTRAINT "postal_areas_lng_range" CHECK ("postal_areas"."lng" BETWEEN -180 AND 180)
);
--> statement-breakpoint
DROP INDEX "service_areas_business_id_idx";--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "business_photos" ADD CONSTRAINT "business_photos_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_photos_business_sort_idx" ON "business_photos" USING btree ("business_id","sort_order");--> statement-breakpoint
CREATE INDEX "postal_areas_lat_lng_idx" ON "postal_areas" USING btree ("lat","lng");--> statement-breakpoint
CREATE INDEX "businesses_published_idx" ON "businesses" USING btree ("published_at") WHERE "businesses"."published_at" IS NOT NULL AND "businesses"."suspended_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "service_areas_business_id_uidx" ON "service_areas" USING btree ("business_id");--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_logo_key_unique" UNIQUE("logo_key");