CREATE TYPE "public"."checkout_status" AS ENUM('open', 'completed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('stripe', 'fake');--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'authorized' BEFORE 'processing';--> statement-breakpoint
CREATE TABLE "booking_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"address_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"work_minutes" integer NOT NULL,
	"timezone" text DEFAULT 'America/Halifax' NOT NULL,
	"instant_book" boolean NOT NULL,
	"price_cents" integer NOT NULL,
	"service_fee_cents" integer NOT NULL,
	"price_tax_cents" integer NOT NULL,
	"fee_tax_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"business_fee_cents" integer NOT NULL,
	"tax_province" "province" NOT NULL,
	"cancellation_policy" "cancellation_policy" NOT NULL,
	"customer_notes" text,
	"provider" "payment_provider" NOT NULL,
	"provider_session_id" text,
	"provider_payment_intent_id" text,
	"status" "checkout_status" DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"booking_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_checkouts_provider_session_id_unique" UNIQUE("provider_session_id"),
	CONSTRAINT "booking_checkouts_provider_payment_intent_id_unique" UNIQUE("provider_payment_intent_id"),
	CONSTRAINT "booking_checkouts_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "booking_checkouts_range" CHECK ("booking_checkouts"."ends_at" > "booking_checkouts"."starts_at"),
	CONSTRAINT "booking_checkouts_work_minutes_range" CHECK ("booking_checkouts"."work_minutes" BETWEEN 1 AND 1440),
	CONSTRAINT "booking_checkouts_service_fee_cents_non_negative" CHECK ("booking_checkouts"."service_fee_cents" >= 0),
	CONSTRAINT "booking_checkouts_price_tax_cents_non_negative" CHECK ("booking_checkouts"."price_tax_cents" >= 0),
	CONSTRAINT "booking_checkouts_fee_tax_cents_non_negative" CHECK ("booking_checkouts"."fee_tax_cents" >= 0),
	CONSTRAINT "booking_checkouts_business_fee_cents_non_negative" CHECK ("booking_checkouts"."business_fee_cents" >= 0),
	CONSTRAINT "booking_checkouts_price_cents_positive" CHECK ("booking_checkouts"."price_cents" > 0),
	CONSTRAINT "booking_checkouts_total_is_sum" CHECK ("booking_checkouts"."total_cents" = "booking_checkouts"."price_cents" + "booking_checkouts"."service_fee_cents" + "booking_checkouts"."price_tax_cents" + "booking_checkouts"."fee_tax_cents"),
	CONSTRAINT "booking_checkouts_completed_fields" CHECK ("booking_checkouts"."status" <> 'completed' OR "booking_checkouts"."completed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "arrival_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arrival_windows_range" CHECK ("arrival_windows"."start_minute" >= 360 AND "arrival_windows"."end_minute" <= 1260 AND "arrival_windows"."end_minute" - "arrival_windows"."start_minute" BETWEEN 60 AND 360),
	CONSTRAINT "arrival_windows_step" CHECK ("arrival_windows"."start_minute" % 15 = 0 AND "arrival_windows"."end_minute" % 15 = 0)
);
--> statement-breakpoint
-- Arrival windows (SPEC §19): one crew member can hold several jobs in a window, and jobs
-- arrive unassigned, so the exact-time overlap guard and the "always assigned" rule go.
ALTER TABLE "visits" DROP CONSTRAINT IF EXISTS "visits_no_member_overlap";--> statement-breakpoint
ALTER TABLE "visits" DROP CONSTRAINT "visits_live_has_member";--> statement-breakpoint
DROP INDEX "availability_rules_member_weekday_idx";--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "work_minutes" integer;--> statement-breakpoint
-- Existing visits used their exact time range as the work time.
UPDATE "visits" SET "work_minutes" = LEAST(1440, GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("ends_at" - "starts_at")) / 60)::integer));--> statement-breakpoint
ALTER TABLE "visits" ALTER COLUMN "work_minutes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "min_notice_days" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "max_days_ahead" smallint DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "payout_setup_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "payout_setup_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "payout_setup_enforced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider" "payment_provider" DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "provider" "payment_provider" DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrival_windows" ADD CONSTRAINT "arrival_windows_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_checkouts_business_starts_idx" ON "booking_checkouts" USING btree ("business_id","starts_at") WHERE "booking_checkouts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "booking_checkouts_open_expires_idx" ON "booking_checkouts" USING btree ("expires_at") WHERE "booking_checkouts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "booking_checkouts_customer_created_idx" ON "booking_checkouts" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "arrival_windows_business_start_uidx" ON "arrival_windows" USING btree ("business_id","start_minute");--> statement-breakpoint
CREATE INDEX "visits_business_starts_idx" ON "visits" USING btree ("business_id","starts_at");--> statement-breakpoint
CREATE INDEX "businesses_payout_setup_due_idx" ON "businesses" USING btree ("payout_setup_due_at") WHERE "businesses"."payout_setup_due_at" IS NOT NULL AND NOT "businesses"."payouts_enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "availability_rules_member_weekday_uidx" ON "availability_rules" USING btree ("member_id","weekday");--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_work_minutes_range" CHECK ("visits"."work_minutes" BETWEEN 1 AND 1440);--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_booking_notice" CHECK ("businesses"."min_notice_days" BETWEEN 0 AND 14 AND "businesses"."max_days_ahead" BETWEEN 7 AND 180 AND "businesses"."min_notice_days" < "businesses"."max_days_ahead");--> statement-breakpoint
-- Default working hours (Monday–Friday, 8 am–5 pm) for crew members who have none yet.
INSERT INTO "availability_rules" ("member_id", "weekday", "start_minute", "end_minute")
SELECT m."id", d.weekday, 480, 1020
FROM "business_members" m
CROSS JOIN (VALUES (1), (2), (3), (4), (5)) AS d(weekday)
WHERE m."active" AND NOT EXISTS (
  SELECT 1 FROM "availability_rules" r WHERE r."member_id" = m."id"
);
