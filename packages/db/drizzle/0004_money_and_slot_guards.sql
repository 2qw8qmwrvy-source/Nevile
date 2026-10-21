-- Custom SQL: integrity rules Drizzle cannot express in the schema.

-- Refunded visits no longer hold their crew member's slot: a visit refunded before the
-- work never happens, and one refunded after disputed work is in the past.
ALTER TABLE "visits" DROP CONSTRAINT "visits_no_member_overlap";
--> statement-breakpoint

ALTER TABLE "visits"
  ADD CONSTRAINT "visits_no_member_overlap"
  EXCLUDE USING gist (
    "assigned_member_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("assigned_member_id" IS NOT NULL AND "status" NOT IN ('cancelled_by_customer', 'cancelled_by_business', 'refunded'));
--> statement-breakpoint

-- A booking's default crew member belongs to the booking's business. Removing the member
-- clears only the assignment (PostgreSQL 15+ column-list SET NULL), never business_id.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_member_business_fk"
  FOREIGN KEY ("business_id", "assigned_member_id")
  REFERENCES "business_members" ("business_id", "id")
  ON DELETE SET NULL ("assigned_member_id");
--> statement-breakpoint

-- One charge shape per booking (SPEC §7): recurring jobs and per-visit snow contracts are
-- charged per visit (visit_id set); one-off and on-demand jobs and season-priced snow
-- contracts are charged once for the booking (visit_id null). With the partial unique
-- indexes on payments, a booking can never hold both a booking-level and a visit-level
-- live charge, so the customer is never charged twice for the same work.
CREATE FUNCTION "payments_check_charge_shape"() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  booking_kind "booking_kind";
  per_visit boolean;
  expects_visit boolean;
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
    expects_visit := per_visit;
  ELSE
    expects_visit := booking_kind = 'recurring';
  END IF;
  IF (NEW."visit_id" IS NOT NULL) <> expects_visit THEN
    RAISE EXCEPTION '% booking % is charged %', booking_kind, NEW."booking_id",
      CASE WHEN expects_visit THEN 'per visit' ELSE 'once for the booking' END
      USING ERRCODE = 'check_violation', CONSTRAINT = 'payments_charge_shape';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "payments_charge_shape"
  BEFORE INSERT OR UPDATE OF "booking_id", "visit_id" ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "payments_check_charge_shape"();
--> statement-breakpoint

-- Live (not failed / cancelled) refunds of a payment never exceed what it collected, in
-- total or in any part (price, service fee, each tax, business-fee reduction), and only
-- collected payments can be refunded. The payment row is locked so concurrent refunds of
-- one payment are checked one after the other.
CREATE FUNCTION "refunds_check_within_payment"() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  paid "payments"%ROWTYPE;
  total record;
BEGIN
  IF NEW."status" IN ('failed', 'cancelled') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO paid FROM "payments" WHERE "payments"."id" = NEW."payment_id" FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports it
  END IF;
  IF paid."status" NOT IN ('succeeded', 'partially_refunded', 'refunded') THEN
    RAISE EXCEPTION 'payment % was not collected (status %), nothing to refund', paid."id", paid."status"
      USING ERRCODE = 'check_violation', CONSTRAINT = 'refunds_within_payment';
  END IF;
  SELECT
    coalesce(sum(r."amount_cents"), 0) + NEW."amount_cents" AS amount,
    coalesce(sum(r."price_cents"), 0) + NEW."price_cents" AS price,
    coalesce(sum(r."service_fee_cents"), 0) + NEW."service_fee_cents" AS service_fee,
    coalesce(sum(r."price_tax_cents"), 0) + NEW."price_tax_cents" AS price_tax,
    coalesce(sum(r."fee_tax_cents"), 0) + NEW."fee_tax_cents" AS fee_tax,
    coalesce(sum(r."business_fee_adjustment_cents"), 0) + NEW."business_fee_adjustment_cents" AS business_fee
  INTO total
  FROM "refunds" r
  WHERE r."payment_id" = NEW."payment_id"
    AND r."id" <> NEW."id"
    AND r."status" NOT IN ('failed', 'cancelled');
  IF total.amount > paid."amount_cents"
    OR total.price > paid."price_cents"
    OR total.service_fee > paid."service_fee_cents"
    OR total.price_tax > paid."price_tax_cents"
    OR total.fee_tax > paid."fee_tax_cents"
    OR total.business_fee > paid."business_fee_cents" THEN
    RAISE EXCEPTION 'refunds of payment % would exceed what it collected', paid."id"
      USING ERRCODE = 'check_violation', CONSTRAINT = 'refunds_within_payment';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "refunds_within_payment"
  BEFORE INSERT OR UPDATE ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION "refunds_check_within_payment"();
