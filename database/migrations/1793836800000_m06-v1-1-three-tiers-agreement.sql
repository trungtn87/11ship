-- Up Migration
-- M06 v1.1 (docs/current/M06-v1.1-3km-3tiers-fee-agreement-20261018.md): exactly three fee bands (no tail formula) and the shipping-fee agreement
-- (proposal / counter-offer / acceptance) data of M06. ADDITIVE: the v1.0 migrations (fee policy, eligibility parameters) are not edited, and every
-- row written under v1.0 stays valid (schema_version 1: any number of bands + a tail). New rows are schema_version 2: three bands, no tail columns.
-- Pricing code reads only version-2 policies; a version-1 policy stays in the history and is never used to price a new quote.
--
-- Radius: the 3 km search radius is a fixed rule in code (SHIPPER_SEARCH_RADIUS_M), not data, so nothing here stores it.

-- ---------------------------------------------------------------------------------------------------
-- Three bands: [0, b1) [b1, b2) [b2, b3] (the last upper bound is INCLUDED), 0 < b1 < b2 < b3 <= 1 000 000 m, fees whole VND 0..10 000 000.
-- ---------------------------------------------------------------------------------------------------
CREATE FUNCTION app.shipping_fee_three_tiers_valid(tiers jsonb) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  i integer;
  el jsonb;
  prev_to bigint := 0;
  f bigint;
  t bigint;
  fee bigint;
BEGIN
  IF tiers IS NULL OR jsonb_typeof(tiers) IS DISTINCT FROM 'array' OR jsonb_array_length(tiers) <> 3 THEN
    RETURN false;
  END IF;
  FOR i IN 0 .. 2 LOOP
    el := tiers -> i;
    IF jsonb_typeof(el) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(el)) <> 3
       OR jsonb_typeof(el -> 'from_m') IS DISTINCT FROM 'number'
       OR jsonb_typeof(el -> 'to_m') IS DISTINCT FROM 'number'
       OR jsonb_typeof(el -> 'fee_vnd') IS DISTINCT FROM 'number'
       OR NOT COALESCE((el ->> 'from_m') ~ '^[0-9]{1,7}$', false)
       OR NOT COALESCE((el ->> 'to_m') ~ '^[0-9]{1,7}$', false)
       OR NOT COALESCE((el ->> 'fee_vnd') ~ '^[0-9]{1,8}$', false) THEN
      RETURN false;
    END IF;
    f := (el ->> 'from_m')::bigint;
    t := (el ->> 'to_m')::bigint;
    fee := (el ->> 'fee_vnd')::bigint;
    IF f <> prev_to OR t <= f OR fee > 10000000 THEN
      RETURN false;
    END IF;
    prev_to := t;
  END LOOP;
  RETURN prev_to <= 1000000;
END;
$$;

-- app.shipping_fee_policy_versions: schema_version 1 (v1.0, tail) or 2 (v1.1, three bands, no tail).
ALTER TABLE app.shipping_fee_policy_versions ADD COLUMN schema_version smallint NOT NULL DEFAULT 1;
ALTER TABLE app.shipping_fee_policy_versions ALTER COLUMN tail_base_fee_vnd DROP NOT NULL;
ALTER TABLE app.shipping_fee_policy_versions ALTER COLUMN tail_step_m DROP NOT NULL;
ALTER TABLE app.shipping_fee_policy_versions ALTER COLUMN tail_step_fee_vnd DROP NOT NULL;
ALTER TABLE app.shipping_fee_policy_versions DROP CONSTRAINT shipping_fee_policy_versions_tiers_ck;
ALTER TABLE app.shipping_fee_policy_versions DROP CONSTRAINT shipping_fee_policy_versions_tail_ck;
ALTER TABLE app.shipping_fee_policy_versions ADD CONSTRAINT shipping_fee_policy_versions_content_ck CHECK (
  (schema_version = 1 AND app.shipping_fee_tiers_valid(tiers)
     AND tail_base_fee_vnd IS NOT NULL AND tail_step_m IS NOT NULL AND tail_step_fee_vnd IS NOT NULL
     AND tail_base_fee_vnd BETWEEN 0 AND 10000000 AND tail_step_m BETWEEN 1 AND 100000 AND tail_step_fee_vnd BETWEEN 0 AND 10000000)
  OR (schema_version = 2 AND app.shipping_fee_three_tiers_valid(tiers)
     AND tail_base_fee_vnd IS NULL AND tail_step_m IS NULL AND tail_step_fee_vnd IS NULL)
);

-- app.shipping_fee_policy_drafts: same two shapes; an empty draft has no content at all.
ALTER TABLE app.shipping_fee_policy_drafts ADD COLUMN schema_version smallint NOT NULL DEFAULT 1;
ALTER TABLE app.shipping_fee_policy_drafts DROP CONSTRAINT shipping_fee_policy_drafts_content_ck;
ALTER TABLE app.shipping_fee_policy_drafts ADD CONSTRAINT shipping_fee_policy_drafts_content_ck CHECK (
  (tiers IS NULL AND tail_base_fee_vnd IS NULL AND tail_step_m IS NULL AND tail_step_fee_vnd IS NULL)
  OR (schema_version = 1 AND app.shipping_fee_tiers_valid(tiers)
     AND tail_base_fee_vnd IS NOT NULL AND tail_step_m IS NOT NULL AND tail_step_fee_vnd IS NOT NULL
     AND tail_base_fee_vnd BETWEEN 0 AND 10000000 AND tail_step_m BETWEEN 1 AND 100000 AND tail_step_fee_vnd BETWEEN 0 AND 10000000)
  OR (schema_version = 2 AND app.shipping_fee_three_tiers_valid(tiers)
     AND tail_base_fee_vnd IS NULL AND tail_step_m IS NULL AND tail_step_fee_vnd IS NULL)
);

-- ---------------------------------------------------------------------------------------------------
-- app.shipping_fee_agreements: one fee agreement per delivery request (M06 owns the rules and the data; M07 owns the delivery and calls it)
-- ---------------------------------------------------------------------------------------------------
-- STANDARD: the fee is the base fee from the 3 bands. AGREED: the shop proposes an amount and a reason; a Shipper may agree, skip or counter; the shop
-- accepts or rejects a counter (rejecting KEEPS the original proposal and does NOT move expires_at: the search clock is M07's and never restarts here).
-- When the CUSTOMER pays and the amount differs from the base fee (or there is no base fee), the customer must confirm before the fee is final.
-- final_fee_vnd stays NULL until then. After picked_up M07 locks it; only an Admin adjustment (logged) may change it afterwards.
-- delivery_id is the M07 delivery's id (M07's table does not exist yet, so there is no foreign key; rows are written only through the M06 service).
CREATE TABLE app.shipping_fee_agreements (
  agreement_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  fee_mode varchar(8) NOT NULL,
  payer varchar(8) NOT NULL,
  status varchar(24) NOT NULL,
  base_fee_vnd bigint,
  base_policy_version_no bigint,
  reason_code varchar(24),
  reason_note varchar(200),
  proposed_fee_vnd bigint,
  counter_fee_vnd bigint,
  counter_by uuid,
  -- The Shipper the agreed amount is bound to (agreed by them, or whose counter-offer the shop accepted). M07 must assign THAT Shipper.
  bound_driver_id uuid,
  pending_fee_vnd bigint,
  pending_source varchar(8),
  final_fee_vnd bigint,
  expires_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  locked_at timestamptz,

  CONSTRAINT shipping_fee_agreements_pkey PRIMARY KEY (agreement_id),
  CONSTRAINT shipping_fee_agreements_delivery_uq UNIQUE (delivery_id),
  CONSTRAINT shipping_fee_agreements_mode_ck CHECK (fee_mode IN ('STANDARD', 'AGREED')),
  CONSTRAINT shipping_fee_agreements_payer_ck CHECK (payer IN ('CUSTOMER', 'SHOP')),
  CONSTRAINT shipping_fee_agreements_status_ck CHECK (status IN ('PROPOSED', 'COUNTERED', 'AWAITING_CUSTOMER', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'LOCKED')),
  CONSTRAINT shipping_fee_agreements_reason_ck CHECK (reason_code IS NULL OR reason_code IN ('URGENT', 'BULKY', 'BAD_WEATHER', 'OUT_OF_PRICE_RANGE', 'OTHER')),
  CONSTRAINT shipping_fee_agreements_amounts_ck CHECK (
    (base_fee_vnd IS NULL OR base_fee_vnd BETWEEN 0 AND 10000000)
    AND (proposed_fee_vnd IS NULL OR proposed_fee_vnd BETWEEN 0 AND 10000000)
    AND (counter_fee_vnd IS NULL OR counter_fee_vnd BETWEEN 0 AND 10000000)
    AND (pending_fee_vnd IS NULL OR pending_fee_vnd BETWEEN 0 AND 10000000)
    AND (final_fee_vnd IS NULL OR final_fee_vnd BETWEEN 0 AND 10000000)
  ),
  -- STANDARD has a base fee, no proposal and no reason; AGREED has a reason and a proposal (the base fee may be NULL: outside the price table).
  CONSTRAINT shipping_fee_agreements_shape_ck CHECK (
    (fee_mode = 'STANDARD' AND base_fee_vnd IS NOT NULL AND base_policy_version_no IS NOT NULL AND proposed_fee_vnd IS NULL AND reason_code IS NULL
       AND status IN ('ACCEPTED', 'LOCKED', 'EXPIRED'))
    OR (fee_mode = 'AGREED' AND reason_code IS NOT NULL AND proposed_fee_vnd IS NOT NULL)
  ),
  CONSTRAINT shipping_fee_agreements_counter_ck CHECK ((status = 'COUNTERED') = (counter_fee_vnd IS NOT NULL AND counter_by IS NOT NULL) AND (counter_fee_vnd IS NULL) = (counter_by IS NULL)),
  CONSTRAINT shipping_fee_agreements_pending_ck CHECK ((status = 'AWAITING_CUSTOMER') = (pending_fee_vnd IS NOT NULL AND pending_source IS NOT NULL) AND (pending_fee_vnd IS NULL) = (pending_source IS NULL)
    AND (pending_source IS NULL OR pending_source IN ('PROPOSAL', 'COUNTER')) AND (status <> 'AWAITING_CUSTOMER' OR payer = 'CUSTOMER')),
  CONSTRAINT shipping_fee_agreements_bound_ck CHECK (fee_mode = 'STANDARD' OR status NOT IN ('AWAITING_CUSTOMER', 'ACCEPTED', 'LOCKED') OR bound_driver_id IS NOT NULL),
  CONSTRAINT shipping_fee_agreements_final_ck CHECK ((status IN ('ACCEPTED', 'LOCKED')) = (final_fee_vnd IS NOT NULL)),
  CONSTRAINT shipping_fee_agreements_locked_ck CHECK ((status = 'LOCKED') = (locked_at IS NOT NULL)),
  CONSTRAINT shipping_fee_agreements_version_ck CHECK (version >= 1),
  CONSTRAINT shipping_fee_agreements_time_ck CHECK (updated_at >= created_at AND expires_at > created_at),
  CONSTRAINT shipping_fee_agreements_created_by_fk FOREIGN KEY (created_by) REFERENCES app.users (user_id),
  CONSTRAINT shipping_fee_agreements_counter_by_fk FOREIGN KEY (counter_by) REFERENCES app.drivers (driver_id),
  CONSTRAINT shipping_fee_agreements_bound_driver_fk FOREIGN KEY (bound_driver_id) REFERENCES app.drivers (driver_id)
);

-- Identity, the proposal and the deadline never change (rejecting a counter-offer therefore cannot restart the search clock); every update advances the
-- version by exactly one and follows the status graph; the deadline may only move forward (M07 extending its own search).
CREATE FUNCTION app.shipping_fee_agreements_guard() RETURNS trigger
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
    OR (OLD.status = 'LOCKED' AND NEW.status = 'LOCKED')
  ) THEN
    RAISE EXCEPTION 'SHIPPING_AGREEMENT_STATUS_TRANSITION' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER shipping_fee_agreements_guard BEFORE UPDATE ON app.shipping_fee_agreements
  FOR EACH ROW EXECUTE FUNCTION app.shipping_fee_agreements_guard();
CREATE TRIGGER shipping_fee_agreements_no_delete BEFORE DELETE OR TRUNCATE ON app.shipping_fee_agreements
  FOR EACH STATEMENT EXECUTE FUNCTION app.shipping_fee_agreements_guard();

-- ---------------------------------------------------------------------------------------------------
-- app.shipping_fee_agreement_events (append-only): who proposed / countered / accepted / rejected / confirmed what amount, when
-- ---------------------------------------------------------------------------------------------------
-- (agreement_id, request_id) is unique: a repeated request of M07 is recognised and answered from the stored outcome, never applied twice.
CREATE TABLE app.shipping_fee_agreement_events (
  event_id uuid NOT NULL,
  agreement_id uuid NOT NULL,
  seq integer NOT NULL,
  event_type varchar(24) NOT NULL,
  actor_type varchar(8) NOT NULL,
  actor_id uuid,
  -- The Shipper (drivers.driver_id) the event is about: who countered, whose counter was rejected, who agreed.
  driver_id uuid,
  amount_vnd bigint,
  reason varchar(200),
  request_id uuid,
  agreement_version bigint NOT NULL,
  created_at timestamptz NOT NULL,

  CONSTRAINT shipping_fee_agreement_events_pkey PRIMARY KEY (event_id),
  CONSTRAINT shipping_fee_agreement_events_seq_uq UNIQUE (agreement_id, seq),
  CONSTRAINT shipping_fee_agreement_events_request_uq UNIQUE (agreement_id, request_id),
  CONSTRAINT shipping_fee_agreement_events_agreement_fk FOREIGN KEY (agreement_id) REFERENCES app.shipping_fee_agreements (agreement_id),
  CONSTRAINT shipping_fee_agreement_events_actor_fk FOREIGN KEY (actor_id) REFERENCES app.users (user_id),
  CONSTRAINT shipping_fee_agreement_events_driver_fk FOREIGN KEY (driver_id) REFERENCES app.drivers (driver_id),
  CONSTRAINT shipping_fee_agreement_events_type_ck CHECK (event_type IN (
    'STANDARD_CREATED', 'PROPOSED', 'DRIVER_ACCEPTED', 'DRIVER_SKIPPED', 'COUNTERED', 'COUNTER_ACCEPTED', 'COUNTER_REJECTED',
    'CUSTOMER_CONFIRMED', 'CUSTOMER_DECLINED', 'EXPIRED', 'LOCKED', 'ADMIN_ADJUSTED', 'DEADLINE_EXTENDED'
  )),
  CONSTRAINT shipping_fee_agreement_events_actor_type_ck CHECK (actor_type IN ('SHOP', 'DRIVER', 'CUSTOMER', 'ADMIN', 'SYSTEM')),
  CONSTRAINT shipping_fee_agreement_events_amount_ck CHECK (amount_vnd IS NULL OR amount_vnd BETWEEN 0 AND 10000000),
  CONSTRAINT shipping_fee_agreement_events_seq_ck CHECK (seq >= 1)
);

CREATE FUNCTION app.shipping_fee_agreement_events_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.shipping_fee_agreement_events is append-only (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER shipping_fee_agreement_events_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON app.shipping_fee_agreement_events
  FOR EACH STATEMENT EXECUTE FUNCTION app.shipping_fee_agreement_events_reject_mutation();

-- Down Migration
-- Only for disposable test or experimental databases. Reverse order; no CASCADE and no IF EXISTS: it fails loudly on drift. It REFUSES when any
-- version-2 policy, version-2 draft or any agreement exists (the v1.0 shape cannot hold them).
DROP TABLE app.shipping_fee_agreement_events;
DROP FUNCTION app.shipping_fee_agreement_events_reject_mutation();
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.shipping_fee_agreements)
     OR EXISTS (SELECT 1 FROM app.shipping_fee_policy_versions WHERE schema_version = 2)
     OR EXISTS (SELECT 1 FROM app.shipping_fee_policy_drafts WHERE schema_version = 2 AND tiers IS NOT NULL) THEN
    RAISE EXCEPTION 'SHIPPING_V11_DOWN_REFUSED' USING ERRCODE = 'restrict_violation';
  END IF;
END;
$$;
DROP TABLE app.shipping_fee_agreements;
DROP FUNCTION app.shipping_fee_agreements_guard();
ALTER TABLE app.shipping_fee_policy_drafts DROP CONSTRAINT shipping_fee_policy_drafts_content_ck;
ALTER TABLE app.shipping_fee_policy_drafts DROP COLUMN schema_version;
ALTER TABLE app.shipping_fee_policy_drafts ADD CONSTRAINT shipping_fee_policy_drafts_content_ck CHECK (
  (tiers IS NULL AND tail_base_fee_vnd IS NULL AND tail_step_m IS NULL AND tail_step_fee_vnd IS NULL)
  OR (
    app.shipping_fee_tiers_valid(tiers)
    AND tail_base_fee_vnd BETWEEN 0 AND 10000000
    AND tail_step_m BETWEEN 1 AND 100000
    AND tail_step_fee_vnd BETWEEN 0 AND 10000000
  )
);
ALTER TABLE app.shipping_fee_policy_versions DROP CONSTRAINT shipping_fee_policy_versions_content_ck;
ALTER TABLE app.shipping_fee_policy_versions DROP COLUMN schema_version;
ALTER TABLE app.shipping_fee_policy_versions ALTER COLUMN tail_base_fee_vnd SET NOT NULL;
ALTER TABLE app.shipping_fee_policy_versions ALTER COLUMN tail_step_m SET NOT NULL;
ALTER TABLE app.shipping_fee_policy_versions ALTER COLUMN tail_step_fee_vnd SET NOT NULL;
ALTER TABLE app.shipping_fee_policy_versions ADD CONSTRAINT shipping_fee_policy_versions_tiers_ck CHECK (app.shipping_fee_tiers_valid(tiers));
ALTER TABLE app.shipping_fee_policy_versions ADD CONSTRAINT shipping_fee_policy_versions_tail_ck CHECK (
  tail_base_fee_vnd BETWEEN 0 AND 10000000 AND tail_step_m BETWEEN 1 AND 100000 AND tail_step_fee_vnd BETWEEN 0 AND 10000000
);
DROP FUNCTION app.shipping_fee_three_tiers_valid(jsonb);
