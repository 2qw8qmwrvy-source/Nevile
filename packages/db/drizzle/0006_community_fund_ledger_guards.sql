-- Custom SQL: community fund ledger guards (SPEC §15) Drizzle cannot express in the schema.

-- Shared by append-only tables: reject UPDATE, DELETE and TRUNCATE.
CREATE FUNCTION "reject_append_only_mutation"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "community_fund_ledger_no_update_delete"
  BEFORE UPDATE OR DELETE ON "community_fund_ledger"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
--> statement-breakpoint

CREATE TRIGGER "community_fund_ledger_no_truncate"
  BEFORE TRUNCATE ON "community_fund_ledger"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_append_only_mutation"();
--> statement-breakpoint

-- Entries that cannot be corrected later must be right when written:
-- * a donation is credited with its full amount, charged exactly its card fee, and never
--   refunded more than was donated; its booking (if given) is the donation's booking;
-- * a payout is for its referral's booking, and never takes the fund balance below zero.
--   Payouts take a transaction-level advisory lock so two cannot spend the same money
--   (each check then sees the previous payout, at READ COMMITTED).
-- Donation refunds are never blocked by the balance: a donor whose booking is refunded in
-- full gets the donation back even if the fund already spent it.
CREATE FUNCTION "community_fund_ledger_check_entry"() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  donation record;
  referral_booking_id uuid;
  balance bigint;
BEGIN
  IF NEW."kind" IN ('donation', 'fee', 'refund') THEN
    SELECT d."amount_cents", d."fee_cents", d."booking_id" INTO donation
      FROM "donations" d WHERE d."id" = NEW."donation_id";
    IF NOT FOUND THEN
      RETURN NEW; -- the foreign key reports it
    END IF;
    IF NEW."booking_id" IS NOT NULL AND NEW."booking_id" IS DISTINCT FROM donation."booking_id" THEN
      RAISE EXCEPTION 'booking % is not the booking of donation %', NEW."booking_id", NEW."donation_id"
        USING ERRCODE = 'check_violation', CONSTRAINT = 'community_fund_ledger_matches_donation';
    END IF;
    IF (NEW."kind" = 'donation' AND NEW."amount_cents" <> donation."amount_cents")
      OR (NEW."kind" = 'fee' AND NEW."amount_cents" <> -donation."fee_cents")
      OR (NEW."kind" = 'refund' AND -NEW."amount_cents" > donation."amount_cents") THEN
      RAISE EXCEPTION '% entry of % cents does not match donation %', NEW."kind", NEW."amount_cents", NEW."donation_id"
        USING ERRCODE = 'check_violation', CONSTRAINT = 'community_fund_ledger_matches_donation';
    END IF;
  ELSIF NEW."kind" = 'payout' THEN
    SELECT r."booking_id" INTO referral_booking_id
      FROM "community_referrals" r WHERE r."id" = NEW."referral_id";
    IF FOUND AND referral_booking_id IS DISTINCT FROM NEW."booking_id" THEN
      RAISE EXCEPTION 'booking % is not the booking of referral %', NEW."booking_id", NEW."referral_id"
        USING ERRCODE = 'check_violation', CONSTRAINT = 'community_fund_ledger_payout_booking';
    END IF;
    PERFORM pg_advisory_xact_lock('community_fund_ledger'::regclass::oid::bigint);
    SELECT coalesce(sum(l."amount_cents"), 0) INTO balance FROM "community_fund_ledger" l;
    IF balance + NEW."amount_cents" < 0 THEN
      RAISE EXCEPTION 'payout of % cents exceeds the community fund balance of % cents', -NEW."amount_cents", balance
        USING ERRCODE = 'check_violation', CONSTRAINT = 'community_fund_ledger_balance';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "community_fund_ledger_check_entry"
  BEFORE INSERT ON "community_fund_ledger"
  FOR EACH ROW EXECUTE FUNCTION "community_fund_ledger_check_entry"();
