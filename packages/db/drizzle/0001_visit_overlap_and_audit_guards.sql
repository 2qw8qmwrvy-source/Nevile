-- Custom SQL: constraints Drizzle cannot express in the schema.

-- btree_gist lets a GiST exclusion constraint combine "=" on a uuid with "&&" on a range.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- A crew member cannot hold two live visits whose [starts_at, ends_at) ranges overlap.
-- Half-open ranges let back-to-back visits touch; cancelled and unassigned visits are exempt.
ALTER TABLE "visits"
  ADD CONSTRAINT "visits_no_member_overlap"
  EXCLUDE USING gist (
    "assigned_member_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("assigned_member_id" IS NOT NULL AND "status" NOT IN ('cancelled_by_customer', 'cancelled_by_business'));
--> statement-breakpoint

-- audit_log is append-only: reject UPDATE, DELETE and TRUNCATE.
CREATE FUNCTION "audit_log_reject_mutation"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "audit_log_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_reject_mutation"();
--> statement-breakpoint

CREATE TRIGGER "audit_log_no_truncate"
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_reject_mutation"();
