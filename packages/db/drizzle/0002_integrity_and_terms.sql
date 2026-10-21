CREATE TYPE "public"."snow_price_basis" AS ENUM('per_visit', 'season');--> statement-breakpoint
ALTER TYPE "public"."dispute_resolution" ADD VALUE 'customer_confirmed';--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_one_per_rater_per_visit";--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_fee_within_amount";--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_assigned_member_id_business_members_id_fk";--> statement-breakpoint
ALTER TABLE "visits" DROP CONSTRAINT "visits_assigned_member_id_business_members_id_fk";--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_rater_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_ratee_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "rater_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "ratee_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_platform_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "suspension_reason" text;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "business_id" uuid;--> statement-breakpoint
UPDATE "visits" SET "business_id" = "bookings"."business_id" FROM "bookings" WHERE "bookings"."id" = "visits"."booking_id";--> statement-breakpoint
ALTER TABLE "visits" ALTER COLUMN "business_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "business_id" uuid;--> statement-breakpoint
UPDATE "payments" SET "business_id" = "bookings"."business_id" FROM "bookings" WHERE "bookings"."id" = "payments"."booking_id";--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "business_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "price_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "price_tax_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "fee_tax_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "business_fee_adjustment_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Refunds recorded before the split: whatever is not service fee was price.
UPDATE "refunds" SET "price_cents" = "amount_cents" - "service_fee_cents";--> statement-breakpoint
ALTER TABLE "tips" ADD COLUMN "booking_id" uuid;--> statement-breakpoint
UPDATE "tips" SET "booking_id" = "visits"."booking_id" FROM "visits" WHERE "visits"."id" = "tips"."visit_id";--> statement-breakpoint
ALTER TABLE "tips" ALTER COLUMN "booking_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tips" ADD COLUMN "stripe_charge_id" text;--> statement-breakpoint
ALTER TABLE "tips" ADD COLUMN "processing_fee_cents" integer;--> statement-breakpoint
ALTER TABLE "tips" ADD COLUMN "succeeded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "kind" "booking_kind";--> statement-breakpoint
UPDATE "quotes" SET "kind" = "quote_requests"."kind" FROM "quote_requests" WHERE "quote_requests"."id" = "quotes"."quote_request_id";--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "frequency" "recurrence_frequency";--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "series_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "price_basis" "snow_price_basis";--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "trigger_cm" integer;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "season_start" date;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "season_end" date;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_id_business_unique" UNIQUE("id","business_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_id_business_customer_unique" UNIQUE("id","business_id","customer_id");--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_id_booking_unique" UNIQUE("id","booking_id");--> statement-breakpoint
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_business_id_unique" UNIQUE("business_id","id");--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_id_business_unique" UNIQUE("id","business_id");--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_stripe_charge_id_unique" UNIQUE("stripe_charge_id");--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_id_kind_unique" UNIQUE("id","kind");--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_one_per_side_per_visit" UNIQUE("visit_id","rater_role");--> statement-breakpoint
-- Live visits must hold a crew member (SPEC §4 slot locking). Existing unassigned live
-- visits go to the business owner until reassigned.
UPDATE "visits" SET "assigned_member_id" = "business_members"."id"
  FROM "business_members"
  WHERE "business_members"."business_id" = "visits"."business_id"
    AND "business_members"."role" = 'owner'
    AND "visits"."assigned_member_id" IS NULL
    AND "visits"."status" NOT IN ('cancelled_by_customer', 'cancelled_by_business', 'refunded');--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_booking_business_fk" FOREIGN KEY ("booking_id","business_id") REFERENCES "public"."bookings"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_member_business_fk" FOREIGN KEY ("business_id","assigned_member_id") REFERENCES "public"."business_members"("business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_business_fk" FOREIGN KEY ("booking_id","business_id") REFERENCES "public"."bookings"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_visit_booking_fk" FOREIGN KEY ("visit_id","booking_id") REFERENCES "public"."visits"("id","booking_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payout_business_fk" FOREIGN KEY ("payout_id","business_id") REFERENCES "public"."payouts"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_visit_booking_fk" FOREIGN KEY ("visit_id","booking_id") REFERENCES "public"."visits"("id","booking_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_booking_parties_fk" FOREIGN KEY ("booking_id","business_id","customer_id") REFERENCES "public"."bookings"("id","business_id","customer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_payout_business_fk" FOREIGN KEY ("payout_id","business_id") REFERENCES "public"."payouts"("id","business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_request_kind_fk" FOREIGN KEY ("quote_request_id","kind") REFERENCES "public"."quote_requests"("id","kind") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_visit_booking_fk" FOREIGN KEY ("visit_id","booking_id") REFERENCES "public"."visits"("id","booking_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_business_fk" FOREIGN KEY ("booking_id","business_id") REFERENCES "public"."bookings"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rater_user_id_user_id_fk" FOREIGN KEY ("rater_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_ratee_user_id_user_id_fk" FOREIGN KEY ("ratee_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_live_has_member" CHECK ("visits"."status" IN ('cancelled_by_customer', 'cancelled_by_business', 'refunded') OR "visits"."assigned_member_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_price_cents_non_negative" CHECK ("refunds"."price_cents" >= 0);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_price_tax_cents_non_negative" CHECK ("refunds"."price_tax_cents" >= 0);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_fee_tax_cents_non_negative" CHECK ("refunds"."fee_tax_cents" >= 0);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_business_fee_adjustment_cents_non_negative" CHECK ("refunds"."business_fee_adjustment_cents" >= 0);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_is_sum" CHECK ("refunds"."amount_cents" = "refunds"."price_cents" + "refunds"."service_fee_cents" + "refunds"."price_tax_cents" + "refunds"."fee_tax_cents");--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_processing_fee_cents_non_negative" CHECK ("tips"."processing_fee_cents" >= 0);--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_recurring_terms" CHECK (CASE WHEN "quotes"."kind" = 'recurring'
        THEN num_nonnulls("quotes"."proposed_start", "quotes"."duration_minutes", "quotes"."frequency", "quotes"."series_ends_at") = 4
          AND "quotes"."series_ends_at" > "quotes"."proposed_start"
        ELSE num_nonnulls("quotes"."frequency", "quotes"."series_ends_at") = 0 END);--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_snow_terms" CHECK (CASE WHEN "quotes"."kind" = 'snow_contract'
        THEN num_nonnulls("quotes"."price_basis", "quotes"."trigger_cm", "quotes"."season_start", "quotes"."season_end") = 4
          AND "quotes"."trigger_cm" > 0 AND "quotes"."season_end" > "quotes"."season_start"
        ELSE num_nonnulls("quotes"."price_basis", "quotes"."trigger_cm", "quotes"."season_start", "quotes"."season_end") = 0 END);
