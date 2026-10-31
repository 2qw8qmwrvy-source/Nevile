CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."booking_kind" AS ENUM('one_off', 'recurring', 'snow_contract', 'on_demand');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('requested', 'quote_requested', 'quoted', 'confirmed', 'completed_pending_confirmation', 'disputed', 'fix_scheduled', 'completed', 'cancelled_by_customer', 'cancelled_by_business', 'declined', 'expired', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."business_member_role" AS ENUM('owner', 'manager', 'crew');--> statement-breakpoint
CREATE TYPE "public"."business_plan" AS ENUM('free', 'pro');--> statement-breakpoint
CREATE TYPE "public"."cancellation_policy" AS ENUM('flexible', 'moderate', 'strict');--> statement-breakpoint
CREATE TYPE "public"."dispute_resolution" AS ENUM('full_payout', 'partial_refund', 'full_refund');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'fix_scheduled', 'escalated', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."party_role" AS ENUM('customer', 'business');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'requires_action', 'processing', 'succeeded', 'failed', 'cancelled', 'partially_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'processing', 'paid', 'failed');--> statement-breakpoint
CREATE TYPE "public"."pricing_type" AS ENUM('fixed', 'quote');--> statement-breakpoint
CREATE TYPE "public"."province" AS ENUM('AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT');--> statement-breakpoint
CREATE TYPE "public"."push_platform" AS ENUM('ios', 'android', 'web');--> statement-breakpoint
CREATE TYPE "public"."quote_request_status" AS ENUM('open', 'quoted', 'accepted', 'declined', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('pending', 'accepted', 'declined', 'expired', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."recurrence_frequency" AS ENUM('weekly', 'biweekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."refund_reason" AS ENUM('customer_cancellation', 'business_cancellation', 'dispute_resolution', 'admin_adjustment');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'paused', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired');--> statement-breakpoint
CREATE TYPE "public"."visit_photo_kind" AS ENUM('before', 'after');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('confirmed', 'completed_pending_confirmation', 'disputed', 'fix_scheduled', 'completed', 'refunded', 'cancelled_by_customer', 'cancelled_by_business');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"phone_number" text,
	"phone_number_verified" boolean DEFAULT false,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan" "business_plan" NOT NULL,
	"monthly_amount_cents" integer NOT NULL,
	"stripe_price_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_prices_stripe_price_id_unique" UNIQUE("stripe_price_id"),
	CONSTRAINT "plan_prices_monthly_amount_cents_non_negative" CHECK ("plan_prices"."monthly_amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_price_id" text,
	"plan" "business_plan" NOT NULL,
	"status" "subscription_status" NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"paused_until" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"pdf_storage_key" text NOT NULL,
	"content_sha256" text NOT NULL,
	"accepted_by_customer_at" timestamp with time zone,
	"accepted_by_business_at" timestamp with time zone,
	"accepted_by_business_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreements_pdf_storage_key_unique" UNIQUE("pdf_storage_key"),
	CONSTRAINT "agreements_booking_version_unique" UNIQUE("booking_id","version"),
	CONSTRAINT "agreements_version_positive" CHECK ("agreements"."version" > 0),
	CONSTRAINT "agreements_content_sha256_hex" CHECK ("agreements"."content_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"address_id" uuid NOT NULL,
	"quote_id" uuid,
	"assigned_member_id" uuid,
	"kind" "booking_kind" NOT NULL,
	"status" "booking_status" NOT NULL,
	"price_cents" integer NOT NULL,
	"service_fee_cents" integer NOT NULL,
	"price_tax_cents" integer DEFAULT 0 NOT NULL,
	"fee_tax_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"tax_province" "province" NOT NULL,
	"cancellation_policy" "cancellation_policy" NOT NULL,
	"timezone" text DEFAULT 'America/Toronto' NOT NULL,
	"requested_starts_at" timestamp with time zone,
	"requested_ends_at" timestamp with time zone,
	"customer_notes" text,
	"stripe_payment_method_id" text,
	"approval_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_quote_id_unique" UNIQUE("quote_id"),
	CONSTRAINT "bookings_price_cents_non_negative" CHECK ("bookings"."price_cents" >= 0),
	CONSTRAINT "bookings_service_fee_cents_non_negative" CHECK ("bookings"."service_fee_cents" >= 0),
	CONSTRAINT "bookings_price_tax_cents_non_negative" CHECK ("bookings"."price_tax_cents" >= 0),
	CONSTRAINT "bookings_fee_tax_cents_non_negative" CHECK ("bookings"."fee_tax_cents" >= 0),
	CONSTRAINT "bookings_total_is_sum" CHECK ("bookings"."total_cents" = "bookings"."price_cents" + "bookings"."service_fee_cents" + "bookings"."price_tax_cents" + "bookings"."fee_tax_cents"),
	CONSTRAINT "bookings_requested_range" CHECK ("bookings"."requested_ends_at" IS NULL OR "bookings"."requested_starts_at" IS NULL OR "bookings"."requested_ends_at" > "bookings"."requested_starts_at"),
	CONSTRAINT "bookings_no_quote_phase_status" CHECK ("bookings"."status" NOT IN ('quote_requested', 'quoted')),
	CONSTRAINT "bookings_requested_expiry" CHECK ("bookings"."status" <> 'requested' OR "bookings"."approval_expires_at" IS NOT NULL),
	CONSTRAINT "bookings_cancelled_fields" CHECK ("bookings"."status" NOT IN ('cancelled_by_customer', 'cancelled_by_business') OR "bookings"."cancelled_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "recurring_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"frequency" "recurrence_frequency" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"generated_through" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_series_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "recurring_series_range" CHECK ("recurring_series"."ends_at" > "recurring_series"."starts_at"),
	CONSTRAINT "recurring_series_duration_positive" CHECK ("recurring_series"."duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "snow_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"trigger_cm" integer NOT NULL,
	"season_start" date NOT NULL,
	"season_end" date NOT NULL,
	"per_visit_cents" integer,
	"season_price_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snow_contracts_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "snow_contracts_trigger_cm_positive" CHECK ("snow_contracts"."trigger_cm" > 0),
	CONSTRAINT "snow_contracts_per_visit_cents_non_negative" CHECK ("snow_contracts"."per_visit_cents" >= 0),
	CONSTRAINT "snow_contracts_season_price_cents_non_negative" CHECK ("snow_contracts"."season_price_cents" >= 0),
	CONSTRAINT "snow_contracts_season_range" CHECK ("snow_contracts"."season_end" > "snow_contracts"."season_start"),
	CONSTRAINT "snow_contracts_one_price" CHECK (num_nonnulls("snow_contracts"."per_visit_cents", "snow_contracts"."season_price_cents") = 1)
);
--> statement-breakpoint
CREATE TABLE "visit_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"kind" "visit_photo_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"uploaded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_photos_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"assigned_member_id" uuid,
	"sequence" integer DEFAULT 1 NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "visit_status" DEFAULT 'confirmed' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" text,
	"confirmed_at" timestamp with time zone,
	"auto_confirmed" boolean DEFAULT false NOT NULL,
	"auto_confirm_at" timestamp with time zone,
	"charge_due_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"business_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visits_booking_sequence_unique" UNIQUE("booking_id","sequence"),
	CONSTRAINT "visits_sequence_positive" CHECK ("visits"."sequence" > 0),
	CONSTRAINT "visits_range" CHECK ("visits"."ends_at" > "visits"."starts_at"),
	CONSTRAINT "visits_marked_complete_fields" CHECK ("visits"."status" NOT IN ('completed_pending_confirmation', 'disputed', 'fix_scheduled', 'completed') OR "visits"."completed_at" IS NOT NULL),
	CONSTRAINT "visits_pending_confirmation_fields" CHECK ("visits"."status" <> 'completed_pending_confirmation' OR "visits"."auto_confirm_at" IS NOT NULL),
	CONSTRAINT "visits_completed_fields" CHECK ("visits"."status" <> 'completed' OR "visits"."confirmed_at" IS NOT NULL),
	CONSTRAINT "visits_cancelled_fields" CHECK ("visits"."status" NOT IN ('cancelled_by_customer', 'cancelled_by_business') OR "visits"."cancelled_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "business_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"invited_by_user_id" text NOT NULL,
	"email" text,
	"phone_number" text,
	"role" "business_member_role" DEFAULT 'crew' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "business_invites_contact" CHECK (num_nonnulls("business_invites"."email", "business_invites"."phone_number") >= 1),
	CONSTRAINT "business_invites_not_owner" CHECK ("business_invites"."role" <> 'owner')
);
--> statement-breakpoint
CREATE TABLE "business_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "business_member_role" DEFAULT 'crew' NOT NULL,
	"calendar_color" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_members_business_user_unique" UNIQUE("business_id","user_id"),
	CONSTRAINT "business_members_calendar_color_hex" CHECK ("business_members"."calendar_color" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"phone" text,
	"email" text,
	"gst_hst_number" text,
	"tax_registered" boolean DEFAULT false NOT NULL,
	"province" "province" NOT NULL,
	"timezone" text DEFAULT 'America/Toronto' NOT NULL,
	"cancellation_policy" "cancellation_policy" DEFAULT 'flexible' NOT NULL,
	"instant_book" boolean DEFAULT false NOT NULL,
	"stripe_account_id" text,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"verified_insurance_at" timestamp with time zone,
	"plan" "business_plan" DEFAULT 'free' NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_slug_unique" UNIQUE("slug"),
	CONSTRAINT "businesses_stripe_account_id_unique" UNIQUE("stripe_account_id"),
	CONSTRAINT "businesses_slug_format" CHECK ("businesses"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "businesses_gst_hst_number_format" CHECK ("businesses"."gst_hst_number" ~ '^[0-9]{9}RT[0-9]{4}$'),
	CONSTRAINT "businesses_tax_registration_number" CHECK (NOT "businesses"."tax_registered" OR "businesses"."gst_hst_number" IS NOT NULL),
	CONSTRAINT "businesses_payouts_require_stripe" CHECK (NOT "businesses"."payouts_enabled" OR "businesses"."stripe_account_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "insurance_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"uploaded_by_user_id" text,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"expires_on" date,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_documents_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "insurance_documents_reviewed" CHECK ("insurance_documents"."status" = 'pending' OR "insurance_documents"."reviewed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "service_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"label" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"radius_km" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_areas_lat_range" CHECK ("service_areas"."lat" BETWEEN -90 AND 90),
	CONSTRAINT "service_areas_lng_range" CHECK ("service_areas"."lng" BETWEEN -180 AND 180),
	CONSTRAINT "service_areas_radius_km_range" CHECK ("service_areas"."radius_km" BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "category_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"requested_by_user_id" text,
	"proposed_name" text NOT NULL,
	"description" text,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"category_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_requests_reviewed" CHECK ("category_requests"."status" = 'pending' OR "category_requests"."reviewed_at" IS NOT NULL),
	CONSTRAINT "category_requests_approved_category" CHECK ("category_requests"."status" <> 'approved' OR "category_requests"."category_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "service_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_categories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "service_categories_slug_format" CHECK ("service_categories"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"pricing_type" "pricing_type" NOT NULL,
	"price_cents" integer,
	"from_price_cents" integer,
	"duration_minutes" integer NOT NULL,
	"instant_book" boolean,
	"booking_kinds" "booking_kind"[] DEFAULT '{"one_off"}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_price_cents_non_negative" CHECK ("services"."price_cents" >= 0),
	CONSTRAINT "services_from_price_cents_non_negative" CHECK ("services"."from_price_cents" >= 0),
	CONSTRAINT "services_price_matches_pricing_type" CHECK (("services"."pricing_type" = 'fixed' AND "services"."price_cents" IS NOT NULL) OR ("services"."pricing_type" = 'quote' AND "services"."price_cents" IS NULL)),
	CONSTRAINT "services_from_price_quote_only" CHECK ("services"."pricing_type" = 'quote' OR "services"."from_price_cents" IS NULL),
	CONSTRAINT "services_instant_book_fixed_only" CHECK ("services"."pricing_type" = 'fixed' OR "services"."instant_book" IS NOT TRUE),
	CONSTRAINT "services_duration_minutes_range" CHECK ("services"."duration_minutes" BETWEEN 1 AND 1440),
	CONSTRAINT "services_booking_kinds_not_empty" CHECK (cardinality("services"."booking_kinds") > 0)
);
--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"label" text,
	"line1" text NOT NULL,
	"line2" text,
	"city" text NOT NULL,
	"province" "province" NOT NULL,
	"postal_code" text NOT NULL,
	"country" text DEFAULT 'CA' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"access_notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "addresses_country_ca" CHECK ("addresses"."country" = 'CA'),
	CONSTRAINT "addresses_postal_code_format" CHECK ("addresses"."postal_code" ~ '^[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z] [0-9][ABCEGHJ-NPRSTV-Z][0-9]$'),
	CONSTRAINT "addresses_lat_lng_together" CHECK (("addresses"."lat" IS NULL) = ("addresses"."lng" IS NULL)),
	CONSTRAINT "addresses_lat_range" CHECK ("addresses"."lat" BETWEEN -90 AND 90),
	CONSTRAINT "addresses_lng_range" CHECK ("addresses"."lng" BETWEEN -180 AND 180)
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"default_address_id" uuid,
	"active_mode" "party_role" DEFAULT 'customer' NOT NULL,
	"stripe_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "profiles_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"opened_by_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"fix_deadline" timestamp with time zone NOT NULL,
	"fix_visit_id" uuid,
	"escalated_at" timestamp with time zone,
	"resolution" "dispute_resolution",
	"refund_cents" integer,
	"resolution_note" text,
	"resolved_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disputes_refund_cents_non_negative" CHECK ("disputes"."refund_cents" >= 0),
	CONSTRAINT "disputes_resolved_fields" CHECK (("disputes"."status" = 'resolved') = ("disputes"."resolution" IS NOT NULL AND "disputes"."resolved_at" IS NOT NULL)),
	CONSTRAINT "disputes_partial_refund_amount" CHECK ("disputes"."resolution" IS DISTINCT FROM 'partial_refund' OR "disputes"."refund_cents" > 0),
	CONSTRAINT "disputes_escalated_fields" CHECK ("disputes"."status" <> 'escalated' OR "disputes"."escalated_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"quote_request_id" uuid,
	"booking_id" uuid,
	"last_message_at" timestamp with time zone,
	"customer_last_read_at" timestamp with time zone,
	"business_last_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_quote_request_id_unique" UNIQUE("quote_request_id"),
	CONSTRAINT "conversations_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "conversations_scoped" CHECK (num_nonnulls("conversations"."quote_request_id", "conversations"."booking_id") >= 1)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_user_id" text NOT NULL,
	"sender_role" "party_role" NOT NULL,
	"body" text NOT NULL,
	"masked_body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_body_length" CHECK (char_length("messages"."body") BETWEEN 1 AND 5000)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"platform" "push_platform" NOT NULL,
	"token" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"visit_id" uuid,
	"stripe_payment_intent_id" text NOT NULL,
	"stripe_charge_id" text,
	"amount_cents" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"service_fee_cents" integer NOT NULL,
	"price_tax_cents" integer DEFAULT 0 NOT NULL,
	"fee_tax_cents" integer DEFAULT 0 NOT NULL,
	"business_fee_cents" integer NOT NULL,
	"processing_fee_cents" integer,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"succeeded_at" timestamp with time zone,
	"failure_code" text,
	"failure_message" text,
	"released_at" timestamp with time zone,
	"payout_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "payments_stripe_charge_id_unique" UNIQUE("stripe_charge_id"),
	CONSTRAINT "payments_amount_cents_non_negative" CHECK ("payments"."amount_cents" >= 0),
	CONSTRAINT "payments_price_cents_non_negative" CHECK ("payments"."price_cents" >= 0),
	CONSTRAINT "payments_service_fee_cents_non_negative" CHECK ("payments"."service_fee_cents" >= 0),
	CONSTRAINT "payments_price_tax_cents_non_negative" CHECK ("payments"."price_tax_cents" >= 0),
	CONSTRAINT "payments_fee_tax_cents_non_negative" CHECK ("payments"."fee_tax_cents" >= 0),
	CONSTRAINT "payments_business_fee_cents_non_negative" CHECK ("payments"."business_fee_cents" >= 0),
	CONSTRAINT "payments_processing_fee_cents_non_negative" CHECK ("payments"."processing_fee_cents" >= 0),
	CONSTRAINT "payments_amount_is_sum" CHECK ("payments"."amount_cents" = "payments"."price_cents" + "payments"."service_fee_cents" + "payments"."price_tax_cents" + "payments"."fee_tax_cents"),
	CONSTRAINT "payments_business_fee_within_price" CHECK ("payments"."business_fee_cents" <= "payments"."price_cents")
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"stripe_transfer_id" text,
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_stripe_transfer_id_unique" UNIQUE("stripe_transfer_id"),
	CONSTRAINT "payouts_business_period_unique" UNIQUE("business_id","period_start"),
	CONSTRAINT "payouts_amount_cents_non_negative" CHECK ("payouts"."amount_cents" >= 0),
	CONSTRAINT "payouts_period_range" CHECK ("payouts"."period_end" > "payouts"."period_start"),
	CONSTRAINT "payouts_paid_fields" CHECK ("payouts"."status" <> 'paid' OR "payouts"."paid_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"dispute_id" uuid,
	"stripe_refund_id" text,
	"amount_cents" integer NOT NULL,
	"service_fee_cents" integer DEFAULT 0 NOT NULL,
	"reason" "refund_reason" NOT NULL,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"initiated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_stripe_refund_id_unique" UNIQUE("stripe_refund_id"),
	CONSTRAINT "refunds_amount_cents_positive" CHECK ("refunds"."amount_cents" > 0),
	CONSTRAINT "refunds_service_fee_cents_non_negative" CHECK ("refunds"."service_fee_cents" >= 0),
	CONSTRAINT "refunds_fee_within_amount" CHECK ("refunds"."service_fee_cents" <= "refunds"."amount_cents")
);
--> statement-breakpoint
CREATE TABLE "tips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"customer_id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"stripe_payment_intent_id" text NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"payout_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tips_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "tips_amount_cents_positive" CHECK ("tips"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "quote_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"address_id" uuid NOT NULL,
	"kind" "booking_kind" DEFAULT 'one_off' NOT NULL,
	"details" text NOT NULL,
	"preferred_days" date[] DEFAULT '{}' NOT NULL,
	"status" "quote_request_status" DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_request_id" uuid NOT NULL,
	"created_by_user_id" text,
	"price_cents" integer NOT NULL,
	"proposed_start" timestamp with time zone,
	"duration_minutes" integer,
	"message" text,
	"status" "quote_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_price_cents_non_negative" CHECK ("quotes"."price_cents" >= 0),
	CONSTRAINT "quotes_expires_after_created" CHECK ("quotes"."expires_at" > "quotes"."created_at"),
	CONSTRAINT "quotes_duration_minutes_positive" CHECK ("quotes"."duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"rater_user_id" text NOT NULL,
	"ratee_user_id" text NOT NULL,
	"rater_role" "party_role" NOT NULL,
	"service_month" text NOT NULL,
	"stars" smallint NOT NULL,
	"comment" text,
	"reply" text,
	"reply_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_one_per_rater_per_visit" UNIQUE("visit_id","rater_user_id"),
	CONSTRAINT "reviews_one_per_side_per_month" UNIQUE("booking_id","rater_role","service_month"),
	CONSTRAINT "reviews_stars_range" CHECK ("reviews"."stars" BETWEEN 1 AND 5),
	CONSTRAINT "reviews_not_self" CHECK ("reviews"."rater_user_id" <> "reviews"."ratee_user_id"),
	CONSTRAINT "reviews_reply_fields" CHECK (("reviews"."reply" IS NULL) = ("reviews"."reply_at" IS NULL)),
	CONSTRAINT "reviews_service_month_format" CHECK ("reviews"."service_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_rules_weekday_range" CHECK ("availability_rules"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "availability_rules_minutes_range" CHECK ("availability_rules"."start_minute" >= 0 AND "availability_rules"."end_minute" <= 1440 AND "availability_rules"."start_minute" < "availability_rules"."end_minute")
);
--> statement-breakpoint
CREATE TABLE "time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_off_range" CHECK ("time_off"."ends_at" > "time_off"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_accepted_by_business_user_id_user_id_fk" FOREIGN KEY ("accepted_by_business_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_assigned_member_id_business_members_id_fk" FOREIGN KEY ("assigned_member_id") REFERENCES "public"."business_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "recurring_series_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snow_contracts" ADD CONSTRAINT "snow_contracts_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_assigned_member_id_business_members_id_fk" FOREIGN KEY ("assigned_member_id") REFERENCES "public"."business_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_completed_by_user_id_user_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_invites" ADD CONSTRAINT "business_invites_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_invites" ADD CONSTRAINT "business_invites_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_invites" ADD CONSTRAINT "business_invites_accepted_by_user_id_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_documents" ADD CONSTRAINT "insurance_documents_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_documents" ADD CONSTRAINT "insurance_documents_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_documents" ADD CONSTRAINT "insurance_documents_reviewed_by_user_id_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_requests" ADD CONSTRAINT "category_requests_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_requests" ADD CONSTRAINT "category_requests_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_requests" ADD CONSTRAINT "category_requests_reviewed_by_user_id_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_requests" ADD CONSTRAINT "category_requests_category_id_service_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."service_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_service_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."service_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_default_address_id_addresses_id_fk" FOREIGN KEY ("default_address_id") REFERENCES "public"."addresses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opened_by_user_id_user_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_fix_visit_id_visits_id_fk" FOREIGN KEY ("fix_visit_id") REFERENCES "public"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_quote_request_id_quote_requests_id_fk" FOREIGN KEY ("quote_request_id") REFERENCES "public"."quote_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_initiated_by_user_id_user_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_quote_request_id_quote_requests_id_fk" FOREIGN KEY ("quote_request_id") REFERENCES "public"."quote_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rater_user_id_user_id_fk" FOREIGN KEY ("rater_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_ratee_user_id_user_id_fk" FOREIGN KEY ("ratee_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_member_id_business_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."business_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_member_id_business_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."business_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_created_idx" ON "audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_uidx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_prices_one_active_per_plan_uidx" ON "plan_prices" USING btree ("plan") WHERE "plan_prices"."active";--> statement-breakpoint
CREATE INDEX "subscriptions_business_id_idx" ON "subscriptions" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_one_live_per_business_uidx" ON "subscriptions" USING btree ("business_id") WHERE "subscriptions"."status" NOT IN ('canceled', 'incomplete_expired');--> statement-breakpoint
CREATE INDEX "bookings_customer_created_idx" ON "bookings" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "bookings_business_status_created_idx" ON "bookings" USING btree ("business_id","status","created_at");--> statement-breakpoint
CREATE INDEX "bookings_service_id_idx" ON "bookings" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "bookings_address_id_idx" ON "bookings" USING btree ("address_id");--> statement-breakpoint
CREATE INDEX "bookings_assigned_member_id_idx" ON "bookings" USING btree ("assigned_member_id");--> statement-breakpoint
CREATE INDEX "bookings_requested_expires_idx" ON "bookings" USING btree ("approval_expires_at") WHERE "bookings"."status" = 'requested';--> statement-breakpoint
CREATE INDEX "bookings_business_cancellations_idx" ON "bookings" USING btree ("business_id","cancelled_at") WHERE "bookings"."status" = 'cancelled_by_business';--> statement-breakpoint
CREATE INDEX "visit_photos_visit_kind_idx" ON "visit_photos" USING btree ("visit_id","kind");--> statement-breakpoint
CREATE INDEX "visits_booking_starts_idx" ON "visits" USING btree ("booking_id","starts_at");--> statement-breakpoint
CREATE INDEX "visits_member_starts_idx" ON "visits" USING btree ("assigned_member_id","starts_at");--> statement-breakpoint
CREATE INDEX "visits_auto_confirm_idx" ON "visits" USING btree ("auto_confirm_at") WHERE "visits"."status" = 'completed_pending_confirmation';--> statement-breakpoint
CREATE INDEX "visits_charge_due_idx" ON "visits" USING btree ("charge_due_at") WHERE "visits"."charge_due_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "business_invites_business_id_idx" ON "business_invites" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "business_members_user_id_idx" ON "business_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_members_one_owner_uidx" ON "business_members" USING btree ("business_id") WHERE "business_members"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "businesses_owner_user_id_idx" ON "businesses" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "insurance_documents_business_id_idx" ON "insurance_documents" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "insurance_documents_status_created_idx" ON "insurance_documents" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "service_areas_business_id_idx" ON "service_areas" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "service_areas_lat_lng_idx" ON "service_areas" USING btree ("lat","lng");--> statement-breakpoint
CREATE INDEX "category_requests_business_id_idx" ON "category_requests" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "category_requests_status_created_idx" ON "category_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "category_requests_one_pending_name_uidx" ON "category_requests" USING btree ("business_id",lower("proposed_name")) WHERE "category_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "service_categories_active_sort_idx" ON "service_categories" USING btree ("active","sort_order");--> statement-breakpoint
CREATE INDEX "services_business_id_idx" ON "services" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "services_category_active_idx" ON "services" USING btree ("category_id","active");--> statement-breakpoint
CREATE INDEX "addresses_user_id_idx" ON "addresses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "disputes_visit_id_idx" ON "disputes" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "disputes_status_fix_deadline_idx" ON "disputes" USING btree ("status","fix_deadline");--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_one_active_per_visit_uidx" ON "disputes" USING btree ("visit_id") WHERE "disputes"."status" <> 'resolved';--> statement-breakpoint
CREATE INDEX "conversations_customer_last_message_idx" ON "conversations" USING btree ("customer_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_business_last_message_idx" ON "conversations" USING btree ("business_id","last_message_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "push_tokens_user_id_idx" ON "push_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payments_booking_id_idx" ON "payments" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "payments_visit_id_idx" ON "payments" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_payout_id_idx" ON "payments" USING btree ("payout_id");--> statement-breakpoint
CREATE INDEX "payments_awaiting_payout_idx" ON "payments" USING btree ("released_at") WHERE "payments"."payout_id" IS NULL AND "payments"."released_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_live_per_visit_uidx" ON "payments" USING btree ("visit_id") WHERE "payments"."visit_id" IS NOT NULL AND "payments"."status" NOT IN ('failed', 'cancelled');--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_live_per_booking_uidx" ON "payments" USING btree ("booking_id") WHERE "payments"."visit_id" IS NULL AND "payments"."status" NOT IN ('failed', 'cancelled');--> statement-breakpoint
CREATE INDEX "payouts_status_idx" ON "payouts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "refunds_payment_id_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refunds_dispute_id_idx" ON "refunds" USING btree ("dispute_id");--> statement-breakpoint
CREATE INDEX "tips_business_created_idx" ON "tips" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "tips_payout_id_idx" ON "tips" USING btree ("payout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tips_one_live_per_visit_uidx" ON "tips" USING btree ("visit_id") WHERE "tips"."status" NOT IN ('failed', 'cancelled');--> statement-breakpoint
CREATE INDEX "quote_requests_business_status_created_idx" ON "quote_requests" USING btree ("business_id","status","created_at");--> statement-breakpoint
CREATE INDEX "quote_requests_customer_created_idx" ON "quote_requests" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "quote_requests_open_expires_idx" ON "quote_requests" USING btree ("expires_at") WHERE "quote_requests"."status" IN ('open', 'quoted');--> statement-breakpoint
CREATE INDEX "quote_requests_service_id_idx" ON "quote_requests" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "quote_requests_address_id_idx" ON "quote_requests" USING btree ("address_id");--> statement-breakpoint
CREATE INDEX "quotes_quote_request_id_idx" ON "quotes" USING btree ("quote_request_id");--> statement-breakpoint
CREATE INDEX "quotes_pending_expires_idx" ON "quotes" USING btree ("expires_at") WHERE "quotes"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_one_pending_per_request_uidx" ON "quotes" USING btree ("quote_request_id") WHERE "quotes"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_one_accepted_per_request_uidx" ON "quotes" USING btree ("quote_request_id") WHERE "quotes"."status" = 'accepted';--> statement-breakpoint
CREATE INDEX "reviews_business_role_created_idx" ON "reviews" USING btree ("business_id","rater_role","created_at");--> statement-breakpoint
CREATE INDEX "reviews_ratee_role_created_idx" ON "reviews" USING btree ("ratee_user_id","rater_role","created_at");--> statement-breakpoint
CREATE INDEX "reviews_rater_user_id_idx" ON "reviews" USING btree ("rater_user_id");--> statement-breakpoint
CREATE INDEX "availability_rules_member_weekday_idx" ON "availability_rules" USING btree ("member_id","weekday");--> statement-breakpoint
CREATE INDEX "time_off_member_starts_idx" ON "time_off" USING btree ("member_id","starts_at");