CREATE TYPE "public"."community_fund_entry_kind" AS ENUM('donation', 'fee', 'payout', 'refund', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."community_partner_role" AS ENUM('coordinator', 'staff');--> statement-breakpoint
CREATE TYPE "public"."community_referral_status" AS ENUM('pending', 'approved', 'declined', 'booked', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."donation_kind" AS ENUM('round_up', 'preset', 'custom');--> statement-breakpoint
CREATE TYPE "public"."donation_status" AS ENUM('pending', 'succeeded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."onboarding_intent" AS ENUM('customer', 'business', 'both');--> statement-breakpoint
CREATE TABLE "community_fund_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "community_fund_entry_kind" NOT NULL,
	"amount_cents" integer NOT NULL,
	"donation_id" uuid,
	"referral_id" uuid,
	"booking_id" uuid,
	"memo" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_fund_ledger_amount_sign" CHECK (CASE "community_fund_ledger"."kind" WHEN 'donation' THEN "community_fund_ledger"."amount_cents" > 0
        WHEN 'adjustment' THEN "community_fund_ledger"."amount_cents" <> 0
        ELSE "community_fund_ledger"."amount_cents" < 0 END),
	CONSTRAINT "community_fund_ledger_links" CHECK (CASE WHEN "community_fund_ledger"."kind" IN ('donation', 'fee', 'refund')
          THEN "community_fund_ledger"."donation_id" IS NOT NULL AND "community_fund_ledger"."referral_id" IS NULL
        WHEN "community_fund_ledger"."kind" = 'payout'
          THEN "community_fund_ledger"."referral_id" IS NOT NULL AND "community_fund_ledger"."booking_id" IS NOT NULL AND "community_fund_ledger"."donation_id" IS NULL
        ELSE true END),
	CONSTRAINT "community_fund_ledger_adjustment_memo" CHECK ("community_fund_ledger"."kind" <> 'adjustment' OR ("community_fund_ledger"."memo" IS NOT NULL AND btrim("community_fund_ledger"."memo") <> ''))
);
--> statement-breakpoint
CREATE TABLE "community_partner_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "community_partner_role" DEFAULT 'staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_partner_members_partner_user_unique" UNIQUE("partner_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "community_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"contact_email" text NOT NULL,
	"region_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_partners_region_id_format" CHECK ("community_partners"."region_id" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "community_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"submitted_by_user_id" text,
	"homeowner_first_name" text NOT NULL,
	"contact_route" text NOT NULL,
	"address_line" text NOT NULL,
	"city" text NOT NULL,
	"postal_code" text NOT NULL,
	"region_id" text NOT NULL,
	"category_id" uuid NOT NULL,
	"preferred_timing" text,
	"notes" text,
	"consent_confirmed_at" timestamp with time zone NOT NULL,
	"status" "community_referral_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"decline_reason" text,
	"booking_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_referrals_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "community_referrals_postal_code_format" CHECK ("community_referrals"."postal_code" ~ '^[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z] [0-9][ABCEGHJ-NPRSTV-Z][0-9]$'),
	CONSTRAINT "community_referrals_region_id_format" CHECK ("community_referrals"."region_id" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "community_referrals_reviewed" CHECK ("community_referrals"."status" IN ('pending', 'cancelled') OR "community_referrals"."reviewed_at" IS NOT NULL),
	CONSTRAINT "community_referrals_decline_reason" CHECK ("community_referrals"."status" <> 'declined' OR "community_referrals"."decline_reason" IS NOT NULL),
	CONSTRAINT "community_referrals_booking" CHECK (CASE WHEN "community_referrals"."status" IN ('booked', 'completed') THEN "community_referrals"."booking_id" IS NOT NULL
        WHEN "community_referrals"."status" IN ('pending', 'approved', 'declined') THEN "community_referrals"."booking_id" IS NULL
        ELSE true END)
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donor_user_id" text NOT NULL,
	"booking_id" uuid,
	"payment_id" uuid,
	"kind" "donation_kind" NOT NULL,
	"amount_cents" integer NOT NULL,
	"fee_cents" integer NOT NULL,
	"net_cents" integer NOT NULL,
	"status" "donation_status" DEFAULT 'pending' NOT NULL,
	"succeeded_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donations_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "donations_amount_cents_positive" CHECK ("donations"."amount_cents" > 0),
	CONSTRAINT "donations_fee_cents_non_negative" CHECK ("donations"."fee_cents" >= 0),
	CONSTRAINT "donations_net_cents_non_negative" CHECK ("donations"."net_cents" >= 0),
	CONSTRAINT "donations_net_is_amount_less_fee" CHECK ("donations"."net_cents" = "donations"."amount_cents" - "donations"."fee_cents"),
	CONSTRAINT "donations_round_up_range" CHECK ("donations"."kind" <> 'round_up' OR "donations"."amount_cents" <= 100),
	CONSTRAINT "donations_payment_has_booking" CHECK ("donations"."payment_id" IS NULL OR "donations"."booking_id" IS NOT NULL),
	CONSTRAINT "donations_status_fields" CHECK (("donations"."status" = 'pending' OR "donations"."succeeded_at" IS NOT NULL) AND ("donations"."status" <> 'refunded' OR "donations"."refunded_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "timezone" SET DEFAULT 'America/Halifax';--> statement-breakpoint
ALTER TABLE "businesses" ALTER COLUMN "timezone" SET DEFAULT 'America/Halifax';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "onboarding_intent" "onboarding_intent";--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "interests" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "marketing_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "marketing_consent_version" text;--> statement-breakpoint
-- Targets of the donations composite FKs below must exist first.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_id_customer_unique" UNIQUE("id","customer_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_id_booking_unique" UNIQUE("id","booking_id");--> statement-breakpoint
ALTER TABLE "community_fund_ledger" ADD CONSTRAINT "community_fund_ledger_donation_id_donations_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."donations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_fund_ledger" ADD CONSTRAINT "community_fund_ledger_referral_id_community_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."community_referrals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_fund_ledger" ADD CONSTRAINT "community_fund_ledger_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_partner_members" ADD CONSTRAINT "community_partner_members_partner_id_community_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."community_partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_partner_members" ADD CONSTRAINT "community_partner_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_partners" ADD CONSTRAINT "community_partners_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_referrals" ADD CONSTRAINT "community_referrals_partner_id_community_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."community_partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_referrals" ADD CONSTRAINT "community_referrals_submitted_by_user_id_user_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_referrals" ADD CONSTRAINT "community_referrals_category_id_service_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."service_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_referrals" ADD CONSTRAINT "community_referrals_reviewed_by_user_id_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_referrals" ADD CONSTRAINT "community_referrals_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_donor_user_id_user_id_fk" FOREIGN KEY ("donor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_booking_customer_fk" FOREIGN KEY ("booking_id","donor_user_id") REFERENCES "public"."bookings"("id","customer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_payment_booking_fk" FOREIGN KEY ("payment_id","booking_id") REFERENCES "public"."payments"("id","booking_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_fund_ledger_created_at_idx" ON "community_fund_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "community_fund_ledger_donation_id_idx" ON "community_fund_ledger" USING btree ("donation_id");--> statement-breakpoint
CREATE INDEX "community_fund_ledger_referral_id_idx" ON "community_fund_ledger" USING btree ("referral_id");--> statement-breakpoint
CREATE INDEX "community_fund_ledger_booking_id_idx" ON "community_fund_ledger" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_fund_ledger_one_per_donation_kind_uidx" ON "community_fund_ledger" USING btree ("donation_id","kind") WHERE "community_fund_ledger"."kind" IN ('donation', 'fee', 'refund');--> statement-breakpoint
CREATE INDEX "community_partner_members_user_id_idx" ON "community_partner_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "community_partners_active_name_idx" ON "community_partners" USING btree ("active","name");--> statement-breakpoint
CREATE INDEX "community_referrals_status_idx" ON "community_referrals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "community_referrals_partner_created_idx" ON "community_referrals" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "community_referrals_category_id_idx" ON "community_referrals" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "donations_donor_created_idx" ON "donations" USING btree ("donor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "donations_booking_id_idx" ON "donations" USING btree ("booking_id");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_postal_code_format" CHECK ("profiles"."postal_code" ~ '^[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z] [0-9][ABCEGHJ-NPRSTV-Z][0-9]$');--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_interests_format" CHECK (cardinality("profiles"."interests") <= 32 AND "profiles"."interests"::text ~ '^[{]([a-z0-9]+(-[a-z0-9]+)*(,[a-z0-9]+(-[a-z0-9]+)*)*)?[}]$');--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_marketing_consent_pair" CHECK (("profiles"."marketing_consent_at" IS NULL) = ("profiles"."marketing_consent_version" IS NULL));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_marketing_consent_version_not_blank" CHECK (btrim("profiles"."marketing_consent_version") <> '');