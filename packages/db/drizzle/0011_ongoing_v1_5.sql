CREATE TYPE "public"."card_setup_kind" AS ENUM('page', 'intent');--> statement-breakpoint
CREATE TYPE "public"."card_setup_status" AS ENUM('open', 'completed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."contract_period_status" AS ENUM('scheduled', 'charged', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."season_billing" AS ENUM('upfront', 'monthly', 'either');--> statement-breakpoint
CREATE TYPE "public"."season_payment" AS ENUM('upfront', 'monthly');--> statement-breakpoint
CREATE TABLE "contract_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"price_cents" integer NOT NULL,
	"service_fee_cents" integer NOT NULL,
	"price_tax_cents" integer DEFAULT 0 NOT NULL,
	"fee_tax_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"charge_due_at" timestamp with time zone NOT NULL,
	"release_at" timestamp with time zone NOT NULL,
	"status" "contract_period_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_periods_booking_sequence_unique" UNIQUE("booking_id","sequence"),
	CONSTRAINT "contract_periods_id_booking_unique" UNIQUE("id","booking_id"),
	CONSTRAINT "contract_periods_sequence_positive" CHECK ("contract_periods"."sequence" > 0),
	CONSTRAINT "contract_periods_price_cents_non_negative" CHECK ("contract_periods"."price_cents" >= 0),
	CONSTRAINT "contract_periods_service_fee_cents_non_negative" CHECK ("contract_periods"."service_fee_cents" >= 0),
	CONSTRAINT "contract_periods_price_tax_cents_non_negative" CHECK ("contract_periods"."price_tax_cents" >= 0),
	CONSTRAINT "contract_periods_fee_tax_cents_non_negative" CHECK ("contract_periods"."fee_tax_cents" >= 0),
	CONSTRAINT "contract_periods_range" CHECK ("contract_periods"."period_end" >= "contract_periods"."period_start"),
	CONSTRAINT "contract_periods_total_is_sum" CHECK ("contract_periods"."total_cents" = "contract_periods"."price_cents" + "contract_periods"."service_fee_cents" + "contract_periods"."price_tax_cents" + "contract_periods"."fee_tax_cents")
);
--> statement-breakpoint
CREATE TABLE "recurring_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"date" date NOT NULL,
	"window_start_minute" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_overrides_series_date_unique" UNIQUE("series_id","date"),
	CONSTRAINT "recurring_overrides_window_start" CHECK ("recurring_overrides"."window_start_minute" IS NULL OR "recurring_overrides"."window_start_minute" BETWEEN 0 AND 1439)
);
--> statement-breakpoint
CREATE TABLE "service_contract_terms" (
	"service_id" uuid PRIMARY KEY NOT NULL,
	"trigger_cm" integer NOT NULL,
	"season_start" date NOT NULL,
	"season_end" date NOT NULL,
	"pricing" "snow_price_basis" NOT NULL,
	"price_cents" integer NOT NULL,
	"season_billing" "season_billing",
	"spots" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_contract_terms_trigger_cm_positive" CHECK ("service_contract_terms"."trigger_cm" > 0),
	CONSTRAINT "service_contract_terms_price_cents_positive" CHECK ("service_contract_terms"."price_cents" > 0),
	CONSTRAINT "service_contract_terms_spots_positive" CHECK ("service_contract_terms"."spots" > 0),
	CONSTRAINT "service_contract_terms_season_range" CHECK ("service_contract_terms"."season_end" > "service_contract_terms"."season_start"),
	CONSTRAINT "service_contract_terms_billing" CHECK (("service_contract_terms"."pricing" = 'season') = ("service_contract_terms"."season_billing" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "card_setups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"kind" "card_setup_kind" NOT NULL,
	"provider_setup_id" text,
	"status" "card_setup_status" DEFAULT 'open' NOT NULL,
	"return_path" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_setups_provider_setup_id_unique" UNIQUE("provider_setup_id"),
	CONSTRAINT "card_setups_return_path_local" CHECK ("card_setups"."return_path" IS NULL OR "card_setups"."return_path" ~ '^/[^/]'),
	CONSTRAINT "card_setups_completed_fields" CHECK ("card_setups"."status" <> 'completed' OR "card_setups"."completed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "payment_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_customers_user_provider_unique" UNIQUE("user_id","provider"),
	CONSTRAINT "payment_customers_provider_customer_unique" UNIQUE("provider","customer_id")
);
--> statement-breakpoint
CREATE TABLE "saved_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"customer_id" text NOT NULL,
	"payment_method_id" text NOT NULL,
	"brand" text NOT NULL,
	"last4" text NOT NULL,
	"exp_month" integer NOT NULL,
	"exp_year" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_cards_user_provider_unique" UNIQUE("user_id","provider"),
	CONSTRAINT "saved_cards_provider_method_unique" UNIQUE("provider","payment_method_id"),
	CONSTRAINT "saved_cards_last4" CHECK ("saved_cards"."last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "saved_cards_exp_month" CHECK ("saved_cards"."exp_month" BETWEEN 1 AND 12)
);
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_stripe_payment_intent_id_unique";--> statement-breakpoint
-- Hand-edited: the quotes FK goes before the unique constraint it depends on.
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_request_kind_fk";--> statement-breakpoint
ALTER TABLE "quote_requests" DROP CONSTRAINT "quote_requests_id_kind_unique";--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_recurring_terms";--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_snow_terms";--> statement-breakpoint
DROP INDEX "payments_one_live_per_booking_uidx";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "pause_reason" text;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD COLUMN "first_date" date;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD COLUMN "window_start_minute" integer;--> statement-breakpoint
-- Hand-edited: series created before v1.5 (if any) get their dates and window from their
-- start and end instants in the booking's zone, then the columns become required.
UPDATE "recurring_series" AS s SET
  "first_date" = (s."starts_at" AT TIME ZONE b."timezone")::date,
  "end_date" = GREATEST((s."ends_at" AT TIME ZONE b."timezone")::date, (s."starts_at" AT TIME ZONE b."timezone")::date + 1),
  "window_start_minute" = (extract(hour FROM s."starts_at" AT TIME ZONE b."timezone") * 60
    + extract(minute FROM s."starts_at" AT TIME ZONE b."timezone"))::integer
FROM "bookings" AS b WHERE b."id" = s."booking_id";--> statement-breakpoint
ALTER TABLE "recurring_series" ALTER COLUMN "first_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_series" ALTER COLUMN "end_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_series" ALTER COLUMN "window_start_minute" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snow_contracts" ADD COLUMN "season_payment" "season_payment";--> statement-breakpoint
ALTER TABLE "snow_contracts" ADD COLUMN "route_position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "recurrence_frequencies" "recurrence_frequency"[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "period_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "frequencies" "recurrence_frequency"[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "season_billing" "season_billing";--> statement-breakpoint
ALTER TABLE "contract_periods" ADD CONSTRAINT "contract_periods_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_overrides" ADD CONSTRAINT "recurring_overrides_series_id_recurring_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."recurring_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_contract_terms" ADD CONSTRAINT "service_contract_terms_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_setups" ADD CONSTRAINT "card_setups_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_customers" ADD CONSTRAINT "payment_customers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_cards" ADD CONSTRAINT "saved_cards_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_periods_due_idx" ON "contract_periods" USING btree ("charge_due_at") WHERE "contract_periods"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "card_setups_user_created_idx" ON "card_setups" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_period_booking_fk" FOREIGN KEY ("period_id","booking_id") REFERENCES "public"."contract_periods"("id","booking_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_period_id_idx" ON "payments" USING btree ("period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_live_per_period_uidx" ON "payments" USING btree ("period_id") WHERE "payments"."period_id" IS NOT NULL AND "payments"."status" NOT IN ('failed', 'cancelled');--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_live_per_booking_uidx" ON "payments" USING btree ("booking_id") WHERE "payments"."visit_id" IS NULL AND "payments"."period_id" IS NULL AND "payments"."status" NOT IN ('failed', 'cancelled');--> statement-breakpoint
ALTER TABLE "quotes" DROP COLUMN "frequency";--> statement-breakpoint
ALTER TABLE "quotes" DROP COLUMN "series_ends_at";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_intent_period_unique" UNIQUE NULLS NOT DISTINCT("stripe_payment_intent_id","period_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pause_ongoing_only" CHECK ("bookings"."paused_at" IS NULL OR "bookings"."kind" IN ('recurring', 'snow_contract'));--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "recurring_series_dates" CHECK ("recurring_series"."end_date" > "recurring_series"."first_date");--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "recurring_series_window_start" CHECK ("recurring_series"."window_start_minute" BETWEEN 0 AND 1439);--> statement-breakpoint
ALTER TABLE "snow_contracts" ADD CONSTRAINT "snow_contracts_season_payment" CHECK (("snow_contracts"."season_price_cents" IS NOT NULL) = ("snow_contracts"."season_payment" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_recurring_fixed_only" CHECK ("services"."pricing_type" = 'fixed' OR cardinality("services"."recurrence_frequencies") = 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_visit_or_period" CHECK (num_nonnulls("payments"."visit_id", "payments"."period_id") <= 1);--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_recurring_terms" CHECK (CASE WHEN "quotes"."kind" = 'recurring'
        THEN cardinality("quotes"."frequencies") > 0 AND "quotes"."duration_minutes" IS NOT NULL
        ELSE cardinality("quotes"."frequencies") = 0 END);--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_snow_terms" CHECK (CASE WHEN "quotes"."kind" = 'snow_contract'
        THEN num_nonnulls("quotes"."price_basis", "quotes"."trigger_cm", "quotes"."season_start", "quotes"."season_end") = 4
          AND "quotes"."trigger_cm" > 0 AND "quotes"."season_end" > "quotes"."season_start"
          AND ("quotes"."price_basis" = 'season') = ("quotes"."season_billing" IS NOT NULL)
        ELSE num_nonnulls("quotes"."price_basis", "quotes"."trigger_cm", "quotes"."season_start", "quotes"."season_end", "quotes"."season_billing") = 0 END);--> statement-breakpoint

-- Custom SQL: one charge shape per booking (SPEC §7, §21). Recurring jobs and per-visit snow
-- contracts are charged per visit (visit_id set); season-priced snow contracts per month
-- of the season (period_id set); one-off and on-demand jobs once for the booking (neither).
CREATE OR REPLACE FUNCTION "payments_check_charge_shape"() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  booking_kind "booking_kind";
  per_visit boolean;
  expected text;
  actual text;
BEGIN
  SELECT "bookings"."kind" INTO booking_kind FROM "bookings" WHERE "bookings"."id" = NEW."booking_id";
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports it
  END IF;
  IF booking_kind = 'snow_contract' THEN
    SELECT "snow_contracts"."per_visit_cents" IS NOT NULL INTO per_visit
      FROM "snow_contracts" WHERE "snow_contracts"."booking_id" = NEW."booking_id";
    IF per_visit IS NULL THEN
      RAISE EXCEPTION 'snow contract terms are missing for booking %', NEW."booking_id"
        USING ERRCODE = 'check_violation', CONSTRAINT = 'payments_charge_shape';
    END IF;
    expected := CASE WHEN per_visit THEN 'per visit' ELSE 'per month' END;
  ELSIF booking_kind = 'recurring' THEN
    expected := 'per visit';
  ELSE
    expected := 'once for the booking';
  END IF;
  actual := CASE
    WHEN NEW."visit_id" IS NOT NULL THEN 'per visit'
    WHEN NEW."period_id" IS NOT NULL THEN 'per month'
    ELSE 'once for the booking' END;
  IF actual <> expected THEN
    RAISE EXCEPTION '% booking % is charged %', booking_kind, NEW."booking_id", expected
      USING ERRCODE = 'check_violation', CONSTRAINT = 'payments_charge_shape';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER "payments_charge_shape" ON "payments";--> statement-breakpoint
CREATE TRIGGER "payments_charge_shape"
  BEFORE INSERT OR UPDATE OF "booking_id", "visit_id", "period_id" ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "payments_check_charge_shape"();
