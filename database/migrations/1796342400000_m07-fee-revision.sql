-- Up Migration
-- M07 Owner decision 2026-10-24 (addendum, fee negotiation): a Shipper may propose another amount for a fee that is already FINAL (the fee of the bands, or an
-- agreed amount) before the goods are picked up, also after taking the delivery. The proposal waits on the agreement row (revision_fee_vnd / revision_by) while the
-- agreement stays ACCEPTED at the fee it had, and its answer time reuses answer_expires_at. When a Shipper's turn ends, an agreed fee that only they accepted goes
-- back to the original: for an AGREED agreement the shop's own proposal is asked again (ACCEPTED -> PROPOSED), so the guard allows that single new transition.
-- Forward-only: existing rows are untouched, constraints are only widened, nothing is rewritten.

ALTER TABLE app.shipping_fee_agreements ADD COLUMN revision_fee_vnd bigint;
ALTER TABLE app.shipping_fee_agreements ADD COLUMN revision_by uuid;
ALTER TABLE app.shipping_fee_agreements ADD CONSTRAINT shipping_fee_agreements_revision_by_fk FOREIGN KEY (revision_by) REFERENCES app.drivers (driver_id);
ALTER TABLE app.shipping_fee_agreements ADD CONSTRAINT shipping_fee_agreements_revision_ck CHECK (
  (revision_fee_vnd IS NULL) = (revision_by IS NULL)
  AND (revision_fee_vnd IS NULL OR (status = 'ACCEPTED' AND revision_fee_vnd BETWEEN 0 AND 10000000))
);

-- The same guard as before, plus ACCEPTED -> PROPOSED for an AGREED agreement (the fee a Shipper alone had agreed goes back to the shop's proposal).
CREATE OR REPLACE FUNCTION app.shipping_fee_agreements_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.shipping_fee_agreements is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.agreement_id <> OLD.agreement_id OR NEW.delivery_id <> OLD.delivery_id OR NEW.fee_mode <> OLD.fee_mode OR NEW.payer <> OLD.payer
     OR NEW.base_fee_vnd IS DISTINCT FROM OLD.base_fee_vnd OR NEW.base_policy_version_no IS DISTINCT FROM OLD.base_policy_version_no
     OR NEW.reason_code IS DISTINCT FROM OLD.reason_code OR NEW.reason_note IS DISTINCT FROM OLD.reason_note
     OR NEW.proposed_fee_vnd IS DISTINCT FROM OLD.proposed_fee_vnd OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHIPPING_AGREEMENT_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.expires_at < OLD.expires_at THEN
    RAISE EXCEPTION 'SHIPPING_AGREEMENT_DEADLINE_NEVER_SHORTENS' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'SHIPPING_AGREEMENT_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT (
    (OLD.status = 'PROPOSED' AND NEW.status IN ('PROPOSED', 'COUNTERED', 'AWAITING_CUSTOMER', 'ACCEPTED', 'EXPIRED'))
    OR (OLD.status = 'COUNTERED' AND NEW.status IN ('PROPOSED', 'COUNTERED', 'AWAITING_CUSTOMER', 'ACCEPTED', 'EXPIRED'))
    OR (OLD.status = 'AWAITING_CUSTOMER' AND NEW.status IN ('PROPOSED', 'ACCEPTED', 'DECLINED', 'EXPIRED'))
    OR (OLD.status = 'ACCEPTED' AND NEW.status IN ('ACCEPTED', 'LOCKED'))
    OR (OLD.status = 'ACCEPTED' AND NEW.status = 'PROPOSED' AND NEW.fee_mode = 'AGREED')
    OR (OLD.status = 'LOCKED' AND NEW.status = 'LOCKED')
  ) THEN
    RAISE EXCEPTION 'SHIPPING_AGREEMENT_STATUS_TRANSITION' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Two more events: a Shipper's waiting proposal withdrawn because their turn ended, and a fee taken back to the original.
ALTER TABLE app.shipping_fee_agreement_events DROP CONSTRAINT shipping_fee_agreement_events_type_ck;
ALTER TABLE app.shipping_fee_agreement_events ADD CONSTRAINT shipping_fee_agreement_events_type_ck CHECK (event_type IN (
  'STANDARD_CREATED', 'PROPOSED', 'DRIVER_ACCEPTED', 'DRIVER_SKIPPED', 'COUNTERED', 'COUNTER_ACCEPTED', 'COUNTER_REJECTED', 'COUNTER_EXPIRED', 'COUNTER_WITHDRAWN',
  'FEE_REVERTED', 'CUSTOMER_CONFIRMED', 'CUSTOMER_DECLINED', 'EXPIRED', 'LOCKED', 'ADMIN_ADJUSTED', 'DEADLINE_EXTENDED'
));

-- Down Migration
-- Preserve immutable history; use a corrective migration after release.
DO $$ BEGIN RAISE EXCEPTION 'M07 fee revision: rollback requires a forward corrective migration'; END $$;
