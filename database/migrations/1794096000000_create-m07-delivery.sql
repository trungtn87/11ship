-- Up Migration
-- M07 (docs/current/M07-implementation-20261018.md): delivery requests, assignments, events, goods-custody incidents and the Shipper's LATEST
-- position (M14: one row per Shipper, overwritten, no trail), plus the M04-A2.2 step the M04 migrations announced: the commission hold and the
-- commission debit become writable, and ONLY those, because their source (a delivery assignment) now exists.
--
-- ADDITIVE and safe on a database with data: it creates tables, functions and triggers, adds one FK to the M06 agreement table (asserted empty of
-- orphans) and REPLACES two functions (the hold source gate and the ledger source gate, same names and signatures, so their triggers keep firing).
-- Nothing is dropped, truncated or rewritten; no CASCADE; earlier migrations are not edited.
--
-- How the gates open (the plan written in the M04 migrations): in ONE transaction (1) assert the compatibility of the existing data (no hold; the ledger holds
-- only TOPUP rows with their topup record, which M04-B2.2b already allows: those rows, balances and history are kept untouched), (2) add the typed foreign key /
-- column to the new source table, (3) replace the gates so they accept exactly a row whose source exists for the same driver and amount (the ledger gate keeps
-- TOPUP and adds COMMISSION_DEBIT). A WITHDRAWAL hold and every ledger kind other than TOPUP and COMMISSION_DEBIT stay refused. Reserve / capture / release move money only through
-- these gates and the deferred checks below, so no commission can be held without an ACTIVE assignment, debited without a CAPTURED hold, or
-- forgotten when an assignment ends.

-- ---------------------------------------------------------------------------------------------------
-- app.deliveries
-- ---------------------------------------------------------------------------------------------------
-- One row per request to call a Shipper. `picked_up` is a MILESTONE (picked_up_at): the state goes straight to `delivering`, so no row rests in
-- `picked_up` (the value stays in the CHECK because the approved vocabulary has it). Order-linked deliveries (source ORDER) carry order_id of M10, which
-- does not exist yet: no foreign key, and the adapter refuses until M10 is connected. Direct calls (source DIRECT) create no Order.
CREATE TABLE app.deliveries (
  delivery_id uuid NOT NULL,
  code varchar(16) NOT NULL,
  source varchar(8) NOT NULL,
  order_id uuid,
  previous_delivery_id uuid,
  shop_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  state varchar(24) NOT NULL,
  -- Snapshots taken when the call is made (a later edit of the shop does not rewrite a delivery).
  shop_name varchar(120) NOT NULL,
  shop_phone varchar(20) NOT NULL,
  pickup_address_text varchar(300) NOT NULL,
  pickup_lat double precision NOT NULL,
  pickup_lng double precision NOT NULL,
  recipient_name varchar(80) NOT NULL,
  recipient_phone varchar(20) NOT NULL,
  dropoff_address_text varchar(300) NOT NULL,
  -- The coarse place a Shipper may see before accepting (never the first, most precise line of the address).
  dropoff_area_text varchar(160),
  dropoff_lat double precision,
  dropoff_lng double precision,
  dropoff_pinned_by uuid,
  dropoff_pinned_at timestamptz,
  goods_description varchar(120) NOT NULL,
  goods_value_vnd bigint NOT NULL,
  paid_vnd bigint NOT NULL,
  note varchar(200),
  fee_mode varchar(20) NOT NULL,
  fee_payer varchar(8) NOT NULL,
  -- NULL = not determined ("Chưa xác định phí"), never 0.
  fee_vnd bigint,
  route_distance_m integer,
  fee_confirmed_by uuid,
  fee_confirmed_at timestamptz,
  search_started_at timestamptz NOT NULL,
  search_expires_at timestamptz NOT NULL,
  search_stopped_at timestamptz,
  reminded_5_at timestamptz,
  reminded_15_at timestamptz,
  picked_up_at timestamptz,
  ended_at timestamptz,
  end_reason varchar(300),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT deliveries_pkey PRIMARY KEY (delivery_id),
  CONSTRAINT deliveries_code_uq UNIQUE (code),
  CONSTRAINT deliveries_source_ck CHECK (source IN ('DIRECT', 'ORDER')),
  CONSTRAINT deliveries_order_ck CHECK ((source = 'ORDER') = (order_id IS NOT NULL)),
  CONSTRAINT deliveries_state_ck CHECK (state IN ('waiting_driver', 'accepted', 'location_confirmed', 'picked_up', 'delivering', 'completed', 'failed', 'cancelled_by_merchant', 'search_stopped')),
  CONSTRAINT deliveries_fee_mode_ck CHECK (fee_mode IN ('STANDARD', 'AGREED', 'PICKUP_AGREEMENT')),
  CONSTRAINT deliveries_fee_payer_ck CHECK (fee_payer IN ('CUSTOMER', 'SHOP')),
  CONSTRAINT deliveries_fee_ck CHECK (fee_vnd IS NULL OR (fee_vnd >= 0 AND fee_vnd <= 10000000)),
  CONSTRAINT deliveries_goods_ck CHECK (goods_value_vnd >= 0 AND goods_value_vnd <= 9007199254740991 AND paid_vnd >= 0 AND paid_vnd <= goods_value_vnd),
  CONSTRAINT deliveries_pickup_point_ck CHECK (pickup_lat BETWEEN -90 AND 90 AND pickup_lng BETWEEN -180 AND 180),
  CONSTRAINT deliveries_dropoff_point_ck CHECK (
    (dropoff_lat IS NULL) = (dropoff_lng IS NULL)
    AND (dropoff_lat IS NULL OR (dropoff_lat BETWEEN -90 AND 90 AND dropoff_lng BETWEEN -180 AND 180))
  ),
  CONSTRAINT deliveries_pin_ck CHECK ((dropoff_pinned_by IS NULL) = (dropoff_pinned_at IS NULL) AND (dropoff_pinned_by IS NULL OR dropoff_lat IS NOT NULL)),
  CONSTRAINT deliveries_fee_confirm_ck CHECK ((fee_confirmed_by IS NULL) = (fee_confirmed_at IS NULL)),
  CONSTRAINT deliveries_route_ck CHECK (route_distance_m IS NULL OR route_distance_m >= 0),
  -- The search lasts exactly 30 minutes from the server clock: never extended, never reset by a cancel of the assignment.
  CONSTRAINT deliveries_search_window_ck CHECK (search_expires_at = search_started_at + interval '30 minutes'),
  -- A stopped search keeps its stop time even if the shop then closes the request (search_stopped -> cancelled_by_merchant).
  CONSTRAINT deliveries_stopped_ck CHECK (state <> 'search_stopped' OR search_stopped_at IS NOT NULL),
  CONSTRAINT deliveries_ended_ck CHECK ((state IN ('completed', 'failed', 'cancelled_by_merchant', 'search_stopped')) = (ended_at IS NOT NULL)),
  -- The goods were picked up before the delivery runs, completes or fails; and pickup needs the pin and the fee.
  CONSTRAINT deliveries_pickup_ck CHECK (
    (state IN ('picked_up', 'delivering', 'completed', 'failed')) = (picked_up_at IS NOT NULL)
    AND (picked_up_at IS NULL OR (fee_vnd IS NOT NULL AND dropoff_lat IS NOT NULL))
  ),
  CONSTRAINT deliveries_version_ck CHECK (version >= 1),
  CONSTRAINT deliveries_time_ck CHECK (updated_at >= created_at),
  CONSTRAINT deliveries_previous_fk FOREIGN KEY (previous_delivery_id) REFERENCES app.deliveries (delivery_id) ON DELETE RESTRICT,
  CONSTRAINT deliveries_shop_fk FOREIGN KEY (shop_id) REFERENCES app.shops (shop_id) ON DELETE RESTRICT,
  CONSTRAINT deliveries_requested_by_fk FOREIGN KEY (requested_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT deliveries_pinned_by_fk FOREIGN KEY (dropoff_pinned_by) REFERENCES app.drivers (driver_id) ON DELETE RESTRICT,
  CONSTRAINT deliveries_fee_confirmed_by_fk FOREIGN KEY (fee_confirmed_by) REFERENCES app.drivers (driver_id) ON DELETE RESTRICT
);
-- A food order has at most ONE active delivery; calling again after it ended creates a new delivery linked by previous_delivery_id.
CREATE UNIQUE INDEX deliveries_order_active_uq ON app.deliveries (order_id)
  WHERE order_id IS NOT NULL AND state IN ('waiting_driver', 'accepted', 'location_confirmed', 'picked_up', 'delivering');
CREATE INDEX deliveries_shop_idx ON app.deliveries (shop_id, created_at DESC);
CREATE INDEX deliveries_waiting_idx ON app.deliveries (search_expires_at) WHERE state = 'waiting_driver';
CREATE INDEX deliveries_previous_idx ON app.deliveries (previous_delivery_id) WHERE previous_delivery_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------
-- app.delivery_assignments
-- ---------------------------------------------------------------------------------------------------
-- One row per time a Shipper took the delivery. At most one ACTIVE per delivery. The commission amount and its policy are SNAPSHOTS of the moment of
-- acceptance (ADR-004): capture uses them, never the current setting. original_eta_at is stored once and never changes (M06 protects it).
CREATE TABLE app.delivery_assignments (
  assignment_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'ACTIVE',
  accepted_at timestamptz NOT NULL,
  original_eta_at timestamptz,
  commission_vnd bigint NOT NULL,
  commission_policy varchar(24) NOT NULL,
  destination_confirmed_at timestamptz,
  picked_up_at timestamptz,
  last_pickup_reminder_at timestamptz,
  ended_at timestamptz,
  end_actor varchar(8),
  end_reason varchar(300),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT delivery_assignments_pkey PRIMARY KEY (assignment_id),
  CONSTRAINT delivery_assignments_delivery_fk FOREIGN KEY (delivery_id) REFERENCES app.deliveries (delivery_id) ON DELETE RESTRICT,
  CONSTRAINT delivery_assignments_driver_fk FOREIGN KEY (driver_id) REFERENCES app.drivers (driver_id) ON DELETE RESTRICT,
  CONSTRAINT delivery_assignments_status_ck CHECK (status IN ('ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED_BY_SHIPPER', 'CANCELLED_BY_SHOP', 'RELEASED_BY_ADMIN')),
  CONSTRAINT delivery_assignments_commission_ck CHECK (commission_vnd >= 1 AND commission_vnd <= 9007199254740991),
  CONSTRAINT delivery_assignments_ended_ck CHECK (
    (status = 'ACTIVE') = (ended_at IS NULL)
    AND (ended_at IS NULL) = (end_actor IS NULL)
    AND (end_actor IS NULL OR end_actor IN ('SHIPPER', 'SHOP', 'ADMIN', 'SYSTEM'))
  ),
  CONSTRAINT delivery_assignments_version_ck CHECK (version >= 1),
  CONSTRAINT delivery_assignments_time_ck CHECK (updated_at >= created_at)
);
CREATE UNIQUE INDEX delivery_assignments_active_uq ON app.delivery_assignments (delivery_id) WHERE status = 'ACTIVE';
CREATE INDEX delivery_assignments_driver_idx ON app.delivery_assignments (driver_id, status);
CREATE INDEX delivery_assignments_delivery_idx ON app.delivery_assignments (delivery_id, accepted_at);

-- ---------------------------------------------------------------------------------------------------
-- app.delivery_events (append-only)
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.delivery_events (
  event_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  seq integer NOT NULL,
  event_type varchar(48) NOT NULL,
  actor_type varchar(8) NOT NULL,
  actor_id uuid,
  assignment_id uuid,
  note varchar(500),
  created_at timestamptz NOT NULL,

  CONSTRAINT delivery_events_pkey PRIMARY KEY (event_id),
  CONSTRAINT delivery_events_seq_uq UNIQUE (delivery_id, seq),
  CONSTRAINT delivery_events_delivery_fk FOREIGN KEY (delivery_id) REFERENCES app.deliveries (delivery_id) ON DELETE RESTRICT,
  CONSTRAINT delivery_events_assignment_fk FOREIGN KEY (assignment_id) REFERENCES app.delivery_assignments (assignment_id) ON DELETE RESTRICT,
  CONSTRAINT delivery_events_actor_ck CHECK (actor_type IN ('SHOP', 'SHIPPER', 'ADMIN', 'SYSTEM')),
  CONSTRAINT delivery_events_type_ck CHECK (event_type ~ '^[a-z][a-z0-9_.]{2,47}$'),
  CONSTRAINT delivery_events_seq_ck CHECK (seq >= 1)
);

-- ---------------------------------------------------------------------------------------------------
-- app.delivery_incidents: who holds the goods after a failed delivery (independent of the terminal state)
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.delivery_incidents (
  incident_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  status varchar(8) NOT NULL DEFAULT 'OPEN',
  custody varchar(8) NOT NULL DEFAULT 'SHIPPER',
  reason_code varchar(32) NOT NULL,
  reason_note varchar(300),
  goods_condition varchar(24) NOT NULL,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  closed_by uuid,
  close_note varchar(500),
  m11_referred_at timestamptz,
  m11_referred_by uuid,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT delivery_incidents_pkey PRIMARY KEY (incident_id),
  CONSTRAINT delivery_incidents_delivery_uq UNIQUE (delivery_id),
  CONSTRAINT delivery_incidents_delivery_fk FOREIGN KEY (delivery_id) REFERENCES app.deliveries (delivery_id) ON DELETE RESTRICT,
  CONSTRAINT delivery_incidents_assignment_fk FOREIGN KEY (assignment_id) REFERENCES app.delivery_assignments (assignment_id) ON DELETE RESTRICT,
  CONSTRAINT delivery_incidents_driver_fk FOREIGN KEY (driver_id) REFERENCES app.drivers (driver_id) ON DELETE RESTRICT,
  CONSTRAINT delivery_incidents_closed_by_fk FOREIGN KEY (closed_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT delivery_incidents_referred_by_fk FOREIGN KEY (m11_referred_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT delivery_incidents_status_ck CHECK (status IN ('OPEN', 'CLOSED')),
  CONSTRAINT delivery_incidents_custody_ck CHECK (custody IN ('SHIPPER', 'SHOP', 'HANDLED')),
  CONSTRAINT delivery_incidents_reason_ck CHECK (reason_code IN ('RECIPIENT_UNREACHABLE', 'RECIPIENT_REFUSED', 'ADDRESS_NOT_FOUND', 'GOODS_PROBLEM', 'VEHICLE_PROBLEM', 'OTHER')),
  CONSTRAINT delivery_incidents_goods_ck CHECK (goods_condition IN ('WITH_SHIPPER', 'RETURNED_TO_SHOP', 'HANDED_TO_RECIPIENT', 'LOST_OR_DAMAGED')),
  -- OPEN means the goods are not settled: the shop has not confirmed them back or dealt with them. A closed incident is settled (SHOP or HANDLED).
  CONSTRAINT delivery_incidents_closed_ck CHECK (
    (status = 'OPEN') = (closed_at IS NULL)
    AND (status = 'OPEN') = (custody = 'SHIPPER')
    AND (closed_at IS NULL OR closed_by IS NOT NULL)
  ),
  CONSTRAINT delivery_incidents_referred_ck CHECK ((m11_referred_at IS NULL) = (m11_referred_by IS NULL)),
  CONSTRAINT delivery_incidents_version_ck CHECK (version >= 1),
  CONSTRAINT delivery_incidents_time_ck CHECK (updated_at >= created_at)
);
CREATE INDEX delivery_incidents_open_idx ON app.delivery_incidents (opened_at) WHERE status = 'OPEN';

-- ---------------------------------------------------------------------------------------------------
-- app.shipper_latest_locations (M14): the Shipper's LATEST position. One row per Shipper, overwritten; there is no history table and no trail.
-- recorded_at is the SERVER clock when the position arrived (a phone clock is never trusted); freshness is judged by readers from it.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.shipper_latest_locations (
  driver_id uuid NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy_m double precision,
  recorded_at timestamptz NOT NULL,

  CONSTRAINT shipper_latest_locations_pkey PRIMARY KEY (driver_id),
  CONSTRAINT shipper_latest_locations_driver_fk FOREIGN KEY (driver_id) REFERENCES app.drivers (driver_id) ON DELETE RESTRICT,
  CONSTRAINT shipper_latest_locations_point_ck CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180),
  CONSTRAINT shipper_latest_locations_accuracy_ck CHECK (accuracy_m IS NULL OR (accuracy_m >= 0 AND accuracy_m <= 100000))
);

-- ---------------------------------------------------------------------------------------------------
-- Rules enforced by the database itself
-- ---------------------------------------------------------------------------------------------------
-- Deliveries: identity, the snapshots, the goods and the search window never change; every update advances the version by exactly one; the state
-- follows the graph; the fee and the drop-off are LOCKED once the goods are picked up, and only an Admin adjustment (which sets the transaction-local
-- flag app.m07_admin_adjust, audited by the service) may change them afterwards. A terminal delivery changes nothing else.
CREATE FUNCTION app.deliveries_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  adjust boolean := COALESCE(current_setting('app.m07_admin_adjust', true), '') = 'on';
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.deliveries is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.delivery_id <> OLD.delivery_id OR NEW.code <> OLD.code OR NEW.source <> OLD.source OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.previous_delivery_id IS DISTINCT FROM OLD.previous_delivery_id OR NEW.shop_id <> OLD.shop_id OR NEW.requested_by <> OLD.requested_by
     OR NEW.shop_name <> OLD.shop_name OR NEW.shop_phone <> OLD.shop_phone OR NEW.pickup_address_text <> OLD.pickup_address_text
     OR NEW.pickup_lat <> OLD.pickup_lat OR NEW.pickup_lng <> OLD.pickup_lng OR NEW.recipient_name <> OLD.recipient_name
     OR NEW.goods_description <> OLD.goods_description OR NEW.goods_value_vnd <> OLD.goods_value_vnd OR NEW.paid_vnd <> OLD.paid_vnd
     OR NEW.fee_mode <> OLD.fee_mode OR NEW.fee_payer <> OLD.fee_payer
     OR NEW.search_started_at <> OLD.search_started_at OR NEW.search_expires_at <> OLD.search_expires_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'DELIVERY_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'DELIVERY_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
       (OLD.state = 'waiting_driver' AND NEW.state IN ('accepted', 'cancelled_by_merchant', 'search_stopped'))
    OR (OLD.state = 'accepted' AND NEW.state IN ('location_confirmed', 'waiting_driver', 'search_stopped', 'cancelled_by_merchant', 'delivering'))
    OR (OLD.state = 'location_confirmed' AND NEW.state IN ('waiting_driver', 'search_stopped', 'cancelled_by_merchant', 'delivering'))
    OR (OLD.state = 'delivering' AND NEW.state IN ('completed', 'failed'))
    OR (OLD.state = 'search_stopped' AND NEW.state = 'cancelled_by_merchant')
  ) THEN
    RAISE EXCEPTION 'DELIVERY_STATE_TRANSITION: % -> %', OLD.state, NEW.state USING ERRCODE = 'restrict_violation';
  END IF;
  -- The fee, the drop-off and the recipient address are fixed once the goods are out (pickup), except by an audited Admin adjustment.
  IF OLD.picked_up_at IS NOT NULL AND NOT adjust AND (
       NEW.fee_vnd IS DISTINCT FROM OLD.fee_vnd OR NEW.dropoff_lat IS DISTINCT FROM OLD.dropoff_lat OR NEW.dropoff_lng IS DISTINCT FROM OLD.dropoff_lng
       OR NEW.dropoff_address_text <> OLD.dropoff_address_text OR NEW.recipient_phone <> OLD.recipient_phone OR NEW.picked_up_at IS DISTINCT FROM OLD.picked_up_at
  ) THEN
    RAISE EXCEPTION 'DELIVERY_FEE_LOCKED' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.state IN ('completed', 'failed', 'cancelled_by_merchant') AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'DELIVERY_TERMINAL' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER deliveries_guard BEFORE UPDATE ON app.deliveries FOR EACH ROW EXECUTE FUNCTION app.deliveries_guard();
CREATE TRIGGER deliveries_no_delete BEFORE DELETE OR TRUNCATE ON app.deliveries FOR EACH STATEMENT EXECUTE FUNCTION app.deliveries_guard();

-- Assignments: identity, the ETA and the commission snapshot never change; only ACTIVE -> an end status, once; the version advances by one.
CREATE FUNCTION app.delivery_assignments_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.delivery_assignments is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.assignment_id <> OLD.assignment_id OR NEW.delivery_id <> OLD.delivery_id OR NEW.driver_id <> OLD.driver_id OR NEW.accepted_at <> OLD.accepted_at
     OR NEW.original_eta_at IS DISTINCT FROM OLD.original_eta_at OR NEW.commission_vnd <> OLD.commission_vnd OR NEW.commission_policy <> OLD.commission_policy
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'ASSIGNMENT_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'ASSIGNMENT_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'ASSIGNMENT_TERMINAL' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER delivery_assignments_guard BEFORE UPDATE ON app.delivery_assignments FOR EACH ROW EXECUTE FUNCTION app.delivery_assignments_guard();
CREATE TRIGGER delivery_assignments_no_delete BEFORE DELETE OR TRUNCATE ON app.delivery_assignments FOR EACH STATEMENT EXECUTE FUNCTION app.delivery_assignments_guard();

-- Events and incidents are never deleted; events are never changed.
CREATE FUNCTION app.delivery_events_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.delivery_events is append-only (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER delivery_events_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON app.delivery_events FOR EACH STATEMENT EXECUTE FUNCTION app.delivery_events_reject_mutation();

CREATE FUNCTION app.delivery_incidents_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.delivery_incidents is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.incident_id <> OLD.incident_id OR NEW.delivery_id <> OLD.delivery_id OR NEW.assignment_id <> OLD.assignment_id OR NEW.driver_id <> OLD.driver_id
     OR NEW.reason_code <> OLD.reason_code OR NEW.goods_condition <> OLD.goods_condition OR NEW.opened_at <> OLD.opened_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'INCIDENT_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'INCIDENT_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'CLOSED' AND (NEW.status <> 'CLOSED' OR NEW.custody <> OLD.custody OR NEW.closed_at IS DISTINCT FROM OLD.closed_at) THEN
    RAISE EXCEPTION 'INCIDENT_CLOSED' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER delivery_incidents_guard BEFORE UPDATE ON app.delivery_incidents FOR EACH ROW EXECUTE FUNCTION app.delivery_incidents_guard();
CREATE TRIGGER delivery_incidents_no_delete BEFORE DELETE OR TRUNCATE ON app.delivery_incidents FOR EACH STATEMENT EXECUTE FUNCTION app.delivery_incidents_guard();

-- The delivery, its assignment and its hold agree, checked at COMMIT for every delivery or assignment touched:
--  * a delivery that is accepted / location_confirmed / delivering has exactly ONE active assignment; every other state has none;
--  * an ACTIVE assignment has an ACTIVE commission hold; COMPLETED has a CAPTURED one; every other end status has a RELEASED one.
CREATE FUNCTION app.m07_assert_delivery(target_delivery uuid) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  delivery_state varchar;
  active_count integer;
  bad_hold integer;
BEGIN
  SELECT d.state INTO delivery_state FROM app.deliveries d WHERE d.delivery_id = target_delivery;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT count(*) INTO active_count FROM app.delivery_assignments a WHERE a.delivery_id = target_delivery AND a.status = 'ACTIVE';
  IF (delivery_state IN ('accepted', 'location_confirmed', 'delivering', 'picked_up') AND active_count <> 1) OR (delivery_state NOT IN ('accepted', 'location_confirmed', 'delivering', 'picked_up') AND active_count <> 0) THEN
    RAISE EXCEPTION 'DELIVERY_INVARIANT_VIOLATION: state % with % active assignment(s)', delivery_state, active_count USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT count(*) INTO bad_hold
    FROM app.delivery_assignments a
    LEFT JOIN app.wallet_holds h ON h.commission_assignment_id = a.assignment_id
   WHERE a.delivery_id = target_delivery
     AND (h.hold_id IS NULL
          OR h.amount_vnd <> a.commission_vnd
          OR (a.status = 'ACTIVE' AND h.status <> 'ACTIVE')
          OR (a.status = 'COMPLETED' AND h.status <> 'CAPTURED')
          OR (a.status NOT IN ('ACTIVE', 'COMPLETED') AND h.status <> 'RELEASED'));
  IF bad_hold > 0 THEN
    RAISE EXCEPTION 'DELIVERY_INVARIANT_VIOLATION: assignment and commission hold disagree' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END;
$$;
CREATE FUNCTION app.m07_delivery_invariants_trigger() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.m07_assert_delivery(NEW.delivery_id);
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER deliveries_invariants AFTER INSERT OR UPDATE ON app.deliveries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.m07_delivery_invariants_trigger();
CREATE CONSTRAINT TRIGGER delivery_assignments_invariants AFTER INSERT OR UPDATE ON app.delivery_assignments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.m07_delivery_invariants_trigger();

-- ---------------------------------------------------------------------------------------------------
-- M06: a fee agreement belongs to a real delivery (asserted: none is orphaned)
-- ---------------------------------------------------------------------------------------------------
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM app.shipping_fee_agreements) THEN
    RAISE EXCEPTION 'M07_MIGRATION_REFUSED: fee agreements exist but no delivery table existed to own them' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$guard$;
ALTER TABLE app.shipping_fee_agreements ADD CONSTRAINT shipping_fee_agreements_delivery_fk
  FOREIGN KEY (delivery_id) REFERENCES app.deliveries (delivery_id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------------------------------
-- M04-A2.2: the commission hold and the commission debit become writable (and nothing else)
-- ---------------------------------------------------------------------------------------------------
-- Compatibility, not emptiness: money may already be in the ledger, but ONLY what the earlier gates allowed. The hold table must be empty (no hold could be
-- written before this migration), and every ledger row must be a TOPUP backed by its topup record (the only kind the gate admitted since M04-B2.2b). Anything else
-- means the database is not in a state this migration understands, and it refuses WITHOUT touching a row. Existing TOPUP rows, balances and history are kept as they are.
DO $guard$
DECLARE
  bad_kinds text;
BEGIN
  IF EXISTS (SELECT 1 FROM app.wallet_holds) THEN
    RAISE EXCEPTION 'M07_MIGRATION_REFUSED: holds exist but no hold source existed before this migration' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT string_agg(DISTINCT entry_kind, ', ') INTO bad_kinds FROM app.wallet_ledger_entries
   WHERE entry_kind <> 'TOPUP' OR topup_id IS NULL OR NOT EXISTS (SELECT 1 FROM app.wallet_topups t WHERE t.topup_id = wallet_ledger_entries.topup_id AND t.wallet_id = wallet_ledger_entries.wallet_id AND t.actual_amount_vnd = wallet_ledger_entries.delta_vnd);
  IF bad_kinds IS NOT NULL THEN
    RAISE EXCEPTION 'M07_MIGRATION_REFUSED: ledger rows other than TOPUP with a topup record exist (%)', bad_kinds USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$guard$;

ALTER TABLE app.wallet_holds ADD CONSTRAINT wallet_holds_commission_assignment_fk
  FOREIGN KEY (commission_assignment_id) REFERENCES app.delivery_assignments (assignment_id) ON DELETE RESTRICT;

ALTER TABLE app.wallet_ledger_entries ADD COLUMN commission_assignment_id uuid;
ALTER TABLE app.wallet_ledger_entries ADD CONSTRAINT wallet_ledger_entries_commission_source_ck CHECK ((entry_kind = 'COMMISSION_DEBIT') = (commission_assignment_id IS NOT NULL));
ALTER TABLE app.wallet_ledger_entries ADD CONSTRAINT wallet_ledger_entries_commission_uq UNIQUE (commission_assignment_id);
ALTER TABLE app.wallet_ledger_entries ADD CONSTRAINT wallet_ledger_entries_commission_fk
  FOREIGN KEY (commission_assignment_id) REFERENCES app.delivery_assignments (assignment_id) ON DELETE RESTRICT;

-- The hold gate: a COMMISSION hold is accepted only for an ACTIVE assignment of the wallet's own driver, for exactly the amount snapshotted on it.
-- A WITHDRAWAL hold (no source yet) and any hold without a valid source are still refused with the same message as before.
CREATE OR REPLACE FUNCTION app.wallet_holds_source_gate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.purpose = 'COMMISSION' AND NEW.commission_assignment_id IS NOT NULL AND EXISTS (
       SELECT 1
         FROM app.delivery_assignments a
         JOIN app.driver_wallets w ON w.driver_id = a.driver_id
        WHERE a.assignment_id = NEW.commission_assignment_id
          AND w.wallet_id = NEW.wallet_id
          AND a.commission_vnd = NEW.amount_vnd
          AND a.status = 'ACTIVE') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'WALLET_HOLD_SOURCE_NOT_AVAILABLE: a hold needs a valid business source and none exists yet'
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- The ledger gate keeps what main opened (M04-B2.2b: a TOPUP row whose topup record exists for the same wallet and the same amount) and opens ONE more kind: a
-- COMMISSION_DEBIT whose hold for the same assignment and wallet is already CAPTURED, for exactly the held amount. Every other kind (WITHDRAWAL_DEBIT,
-- ADJUSTMENT_CREDIT, ADJUSTMENT_DEBIT) and every row without its own source is refused with the same error as before.
CREATE OR REPLACE FUNCTION app.wallet_ledger_source_gate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entry_kind = 'TOPUP' AND NEW.topup_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM app.wallet_topups t
        WHERE t.topup_id = NEW.topup_id AND t.wallet_id = NEW.wallet_id AND t.actual_amount_vnd = NEW.delta_vnd
     ) THEN
    RETURN NEW;
  END IF;
  IF NEW.entry_kind = 'COMMISSION_DEBIT' AND NEW.commission_assignment_id IS NOT NULL AND EXISTS (
       SELECT 1
         FROM app.wallet_holds h
        WHERE h.commission_assignment_id = NEW.commission_assignment_id
          AND h.wallet_id = NEW.wallet_id
          AND h.purpose = 'COMMISSION'
          AND h.status = 'CAPTURED'
          AND h.amount_vnd = -NEW.delta_vnd) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'WALLET_LEDGER_SOURCE_NOT_AVAILABLE: a ledger row needs a valid business source and none exists for it'
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- A CAPTURED commission hold has exactly one commission debit of its amount, and a commission debit has a CAPTURED hold: checked at COMMIT, so
-- "capture" can never reduce the held amount without taking the commission (the wallet invariant alone would not notice).
CREATE FUNCTION app.wallet_commission_capture_assert(target_assignment uuid) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  hold_status varchar;
  hold_amount bigint;
  debit_count integer;
  debit_sum bigint;
BEGIN
  SELECT h.status, h.amount_vnd INTO hold_status, hold_amount FROM app.wallet_holds h WHERE h.commission_assignment_id = target_assignment;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT count(*), COALESCE(SUM(-l.delta_vnd), 0) INTO debit_count, debit_sum FROM app.wallet_ledger_entries l WHERE l.commission_assignment_id = target_assignment;
  IF (hold_status = 'CAPTURED' AND (debit_count <> 1 OR debit_sum <> hold_amount)) OR (hold_status <> 'CAPTURED' AND debit_count <> 0) THEN
    RAISE EXCEPTION 'WALLET_INVARIANT_VIOLATION: a commission hold and its debit disagree' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END;
$$;
CREATE FUNCTION app.wallet_commission_hold_trigger() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.purpose = 'COMMISSION' THEN
    PERFORM app.wallet_commission_capture_assert(NEW.commission_assignment_id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE FUNCTION app.wallet_commission_ledger_trigger() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.commission_assignment_id IS NOT NULL THEN
    PERFORM app.wallet_commission_capture_assert(NEW.commission_assignment_id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER wallet_holds_commission_capture AFTER INSERT OR UPDATE ON app.wallet_holds
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.wallet_commission_hold_trigger();
CREATE CONSTRAINT TRIGGER wallet_ledger_commission_capture AFTER INSERT ON app.wallet_ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.wallet_commission_ledger_trigger();

-- Down Migration
-- Only for disposable test or experimental databases. Reverse order; no CASCADE and no IF EXISTS: it fails loudly on drift.
-- Safety latch: delivery history and the money it moved are never dropped (TOPUP money posted before or after this migration is not delivery history and stays untouched). Everything is locked first so no row can appear between the check and the
-- DROP; the down migration is refused, with the data untouched, if ANY delivery, assignment, event, incident, position, commission hold or commission
-- debit exists.
LOCK TABLE app.deliveries, app.delivery_assignments, app.delivery_events, app.delivery_incidents, app.shipper_latest_locations, app.wallet_holds, app.wallet_ledger_entries, app.shipping_fee_agreements IN ACCESS EXCLUSIVE MODE;
DO $latch$
DECLARE
  rows_found bigint;
BEGIN
  SELECT (SELECT count(*) FROM app.deliveries) + (SELECT count(*) FROM app.delivery_assignments) + (SELECT count(*) FROM app.delivery_events)
       + (SELECT count(*) FROM app.delivery_incidents) + (SELECT count(*) FROM app.shipper_latest_locations)
       + (SELECT count(*) FROM app.wallet_holds WHERE purpose = 'COMMISSION') + (SELECT count(*) FROM app.wallet_ledger_entries WHERE commission_assignment_id IS NOT NULL)
    INTO rows_found;
  IF rows_found > 0 THEN
    RAISE EXCEPTION 'M07_DOWN_REFUSED: % delivery or commission row(s) exist; delivery history is never dropped', rows_found USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$latch$;
DROP TRIGGER wallet_ledger_commission_capture ON app.wallet_ledger_entries;
DROP TRIGGER wallet_holds_commission_capture ON app.wallet_holds;
DROP FUNCTION app.wallet_commission_ledger_trigger();
DROP FUNCTION app.wallet_commission_hold_trigger();
DROP FUNCTION app.wallet_commission_capture_assert(uuid);
-- Back to the gates of main: the ledger gate keeps accepting TOPUP with its topup record (M04-B2.2b, byte for byte) and refuses everything else; the hold gate is closed.
CREATE OR REPLACE FUNCTION app.wallet_ledger_source_gate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entry_kind = 'TOPUP' AND NEW.topup_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM app.wallet_topups t
        WHERE t.topup_id = NEW.topup_id AND t.wallet_id = NEW.wallet_id AND t.actual_amount_vnd = NEW.delta_vnd
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'WALLET_LEDGER_SOURCE_NOT_AVAILABLE: a ledger row needs a valid business source and none exists for it'
    USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE OR REPLACE FUNCTION app.wallet_holds_source_gate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WALLET_HOLD_SOURCE_NOT_AVAILABLE: a hold needs a valid business source and none exists yet'
    USING ERRCODE = 'restrict_violation';
END;
$$;
ALTER TABLE app.wallet_ledger_entries DROP CONSTRAINT wallet_ledger_entries_commission_fk;
ALTER TABLE app.wallet_ledger_entries DROP CONSTRAINT wallet_ledger_entries_commission_uq;
ALTER TABLE app.wallet_ledger_entries DROP CONSTRAINT wallet_ledger_entries_commission_source_ck;
ALTER TABLE app.wallet_ledger_entries DROP COLUMN commission_assignment_id;
ALTER TABLE app.wallet_holds DROP CONSTRAINT wallet_holds_commission_assignment_fk;
ALTER TABLE app.shipping_fee_agreements DROP CONSTRAINT shipping_fee_agreements_delivery_fk;
DROP TRIGGER delivery_assignments_invariants ON app.delivery_assignments;
DROP TRIGGER deliveries_invariants ON app.deliveries;
DROP FUNCTION app.m07_delivery_invariants_trigger();
DROP FUNCTION app.m07_assert_delivery(uuid);
DROP TRIGGER delivery_incidents_no_delete ON app.delivery_incidents;
DROP TRIGGER delivery_incidents_guard ON app.delivery_incidents;
DROP FUNCTION app.delivery_incidents_guard();
DROP TRIGGER delivery_events_append_only ON app.delivery_events;
DROP FUNCTION app.delivery_events_reject_mutation();
DROP TRIGGER delivery_assignments_no_delete ON app.delivery_assignments;
DROP TRIGGER delivery_assignments_guard ON app.delivery_assignments;
DROP FUNCTION app.delivery_assignments_guard();
DROP TRIGGER deliveries_no_delete ON app.deliveries;
DROP TRIGGER deliveries_guard ON app.deliveries;
DROP FUNCTION app.deliveries_guard();
DROP TABLE app.shipper_latest_locations;
DROP TABLE app.delivery_incidents;
DROP TABLE app.delivery_events;
DROP TABLE app.delivery_assignments;
DROP TABLE app.deliveries;
