CREATE TYPE "public"."quote_request_close_reason" AS ENUM('customer_closed', 'chose_another', 'no_reply', 'quote_expired');--> statement-breakpoint
CREATE TYPE "public"."quote_timing" AS ENUM('asap', 'within_week', 'within_month', 'flexible');--> statement-breakpoint
CREATE TABLE "private_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"quote_request_group_id" uuid,
	"message_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_photos_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "private_photos_dimensions" CHECK ("private_photos"."width" > 0 AND "private_photos"."height" > 0),
	CONSTRAINT "private_photos_one_owner" CHECK (num_nonnulls("private_photos"."quote_request_group_id", "private_photos"."message_id") <= 1)
);
--> statement-breakpoint
CREATE TABLE "quote_request_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" text NOT NULL,
	"category_id" uuid NOT NULL,
	"kind" "booking_kind" DEFAULT 'one_off' NOT NULL,
	"details" text NOT NULL,
	"postal_code" text NOT NULL,
	"postal_area" text NOT NULL,
	"timing" "quote_timing" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_request_groups_details_length" CHECK (char_length("quote_request_groups"."details") BETWEEN 1 AND 2000),
	CONSTRAINT "quote_request_groups_postal_area" CHECK ("quote_request_groups"."postal_area" ~ '^[A-Z][0-9][A-Z]$')
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_body_length";--> statement-breakpoint
ALTER TABLE "quote_requests" DROP CONSTRAINT "quote_requests_address_id_addresses_id_fk";
--> statement-breakpoint
DROP INDEX "quote_requests_address_id_idx";--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD COLUMN "quote_id" uuid;--> statement-breakpoint
-- Existing bookings and checkouts take their service's title, then the column is required.
ALTER TABLE "booking_checkouts" ADD COLUMN "title" text;--> statement-breakpoint
UPDATE "booking_checkouts" SET "title" = "services"."title" FROM "services" WHERE "services"."id" = "booking_checkouts"."service_id";--> statement-breakpoint
ALTER TABLE "booking_checkouts" ALTER COLUMN "title" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "title" text;--> statement-breakpoint
UPDATE "bookings" SET "title" = "services"."title" FROM "services" WHERE "services"."id" = "bookings"."service_id";--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "title" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "accepts_quote_requests" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "customer_emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "business_emailed_at" timestamp with time zone;--> statement-breakpoint
-- No released version created quote requests (the quote flow starts in v1.4), so any rows
-- here are leftovers from local experiments; they can't be given a group.
DELETE FROM "quote_requests";--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "group_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "close_reason" "quote_request_close_reason";--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "decline_reason" text;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "responded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "private_photos" ADD CONSTRAINT "private_photos_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_photos" ADD CONSTRAINT "private_photos_quote_request_group_id_quote_request_groups_id_fk" FOREIGN KEY ("quote_request_group_id") REFERENCES "public"."quote_request_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_photos" ADD CONSTRAINT "private_photos_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_request_groups" ADD CONSTRAINT "quote_request_groups_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_request_groups" ADD CONSTRAINT "quote_request_groups_category_id_service_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."service_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "private_photos_owner_created_idx" ON "private_photos" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "private_photos_group_idx" ON "private_photos" USING btree ("quote_request_group_id");--> statement-breakpoint
CREATE INDEX "private_photos_message_idx" ON "private_photos" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "private_photos_unattached_idx" ON "private_photos" USING btree ("created_at") WHERE "private_photos"."quote_request_group_id" IS NULL AND "private_photos"."message_id" IS NULL;--> statement-breakpoint
CREATE INDEX "quote_request_groups_customer_created_idx" ON "quote_request_groups" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "quote_request_groups_category_id_idx" ON "quote_request_groups" USING btree ("category_id");--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_group_id_quote_request_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."quote_request_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" DROP COLUMN "address_id";--> statement-breakpoint
ALTER TABLE "quote_requests" DROP COLUMN "details";--> statement-breakpoint
ALTER TABLE "quote_requests" DROP COLUMN "preferred_days";--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_group_business_unique" UNIQUE("group_id","business_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_body_length" CHECK (char_length("messages"."body") BETWEEN 0 AND 5000);--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_decline_reason" CHECK (("quote_requests"."status" = 'declined') = ("quote_requests"."decline_reason" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_close_reason" CHECK (("quote_requests"."status" IN ('expired', 'cancelled')) = ("quote_requests"."close_reason" IS NOT NULL));