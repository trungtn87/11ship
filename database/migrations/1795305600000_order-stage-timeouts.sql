-- Up Migration
-- #153: one immutable server-clock policy snapshot per new stage. Existing stages retain their pre-release behavior.
CREATE TABLE app.order_timeout_policy (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), version integer NOT NULL CHECK(version>0), parameters jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_by uuid REFERENCES app.users(user_id)
);
CREATE FUNCTION app.valid_timeout_policy(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_typeof(v)='object' AND
 (SELECT count(*)=7 AND bool_and(jsonb_typeof(value)='number' AND value::text ~ '^[0-9]+$' AND (value::text)::numeric BETWEEN 1 AND 1440) FROM jsonb_each(v))
 AND v ?& ARRAY['confirmation_reminder','confirmation_interval','confirmation_cancel','search_stop','search_cancel','pickup_warning','pickup_cancel']
 AND (v->>'confirmation_reminder')::int < (v->>'confirmation_cancel')::int
 AND (v->>'confirmation_interval')::int < (v->>'confirmation_cancel')::int
 AND (v->>'search_stop')::int <= (v->>'search_cancel')::int
 AND (v->>'pickup_warning')::int < (v->>'pickup_cancel')::int
$$;
ALTER TABLE app.order_timeout_policy ADD CHECK(app.valid_timeout_policy(parameters));
INSERT INTO app.order_timeout_policy(version,parameters) VALUES(1,'{"confirmation_reminder":15,"confirmation_interval":5,"confirmation_cancel":30,"search_stop":30,"search_cancel":60,"pickup_warning":30,"pickup_cancel":60}');
CREATE TABLE app.order_timeout_policy_changes (
 change_id uuid PRIMARY KEY, version integer NOT NULL UNIQUE, old_values jsonb NOT NULL, new_values jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES app.users(user_id), request_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER timeout_policy_changes_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON app.order_timeout_policy_changes
 FOR EACH STATEMENT EXECUTE FUNCTION app.order_events_reject_mutation();
ALTER TABLE app.orders ADD COLUMN timeout_snapshot jsonb, ADD COLUMN timeout_next_reminder_at timestamptz;
ALTER TABLE app.deliveries ADD COLUMN timeout_snapshot jsonb;
ALTER TABLE app.delivery_assignments ADD COLUMN timeout_snapshot jsonb, ADD COLUMN timeout_warned_at timestamptz;
CREATE FUNCTION app.snapshot_order_timeout() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p app.order_timeout_policy%ROWTYPE; started timestamptz; warning integer; cancelling integer;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.timeout_snapshot IS DISTINCT FROM OLD.timeout_snapshot THEN
   RAISE EXCEPTION 'TIMEOUT_SNAPSHOT_IMMUTABLE' USING ERRCODE='restrict_violation';
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO STRICT p FROM app.order_timeout_policy WHERE id;
 IF TG_TABLE_NAME='orders' THEN
  IF NEW.scheduled_for IS NOT NULL THEN RETURN NEW; END IF;
  started:=NEW.created_at;warning:=(p.parameters->>'confirmation_reminder')::int;cancelling:=(p.parameters->>'confirmation_cancel')::int;
  NEW.timeout_next_reminder_at:=started+make_interval(mins=>warning);
 ELSIF TG_TABLE_NAME='deliveries' THEN
  started:=NEW.search_started_at;warning:=(p.parameters->>'search_stop')::int;cancelling:=(p.parameters->>'search_cancel')::int;
  NEW.search_expires_at:=started+make_interval(mins=>warning);
 ELSE
  started:=NEW.accepted_at;warning:=(p.parameters->>'pickup_warning')::int;cancelling:=(p.parameters->>'pickup_cancel')::int;
 END IF;
 NEW.timeout_snapshot:=jsonb_build_object('rule_version',p.version,'started_at',started,'warning_at',started+make_interval(mins=>warning),
 'cancel_at',started+make_interval(mins=>cancelling),'reminder_interval',(p.parameters->>'confirmation_interval')::int);
 RETURN NEW;
END $$;
CREATE TRIGGER timeout_snapshot_orders BEFORE INSERT OR UPDATE ON app.orders FOR EACH ROW EXECUTE FUNCTION app.snapshot_order_timeout();
CREATE TRIGGER timeout_snapshot_deliveries BEFORE INSERT OR UPDATE ON app.deliveries FOR EACH ROW EXECUTE FUNCTION app.snapshot_order_timeout();
CREATE TRIGGER timeout_snapshot_assignments BEFORE INSERT OR UPDATE ON app.delivery_assignments FOR EACH ROW EXECUTE FUNCTION app.snapshot_order_timeout();
ALTER TABLE app.deliveries DROP CONSTRAINT deliveries_search_window_ck;
ALTER TABLE app.deliveries ADD CONSTRAINT deliveries_search_window_ck CHECK(search_expires_at>search_started_at);
ALTER TABLE app.orders DROP CONSTRAINT orders_status_ck, DROP CONSTRAINT orders_confirmed_ck, DROP CONSTRAINT orders_ended_ck;
ALTER TABLE app.orders ADD CONSTRAINT orders_status_ck CHECK(status IN ('PENDING_CONFIRMATION','PREPARING','COMPLETED','CANCELLED_BY_CUSTOMER','CANCELLED_BY_SHOP','CANCELLED_BY_SYSTEM','REJECTED_BY_SHOP','NOT_COMPLETED')),
 ADD CONSTRAINT orders_confirmed_ck CHECK(CASE WHEN status='CANCELLED_BY_SYSTEM' THEN true ELSE (confirmed_at IS NOT NULL)=(status IN ('PREPARING','COMPLETED','CANCELLED_BY_SHOP','NOT_COMPLETED')) END),
 ADD CONSTRAINT orders_ended_ck CHECK((ended_at IS NOT NULL)=(status IN ('COMPLETED','CANCELLED_BY_CUSTOMER','CANCELLED_BY_SHOP','CANCELLED_BY_SYSTEM','REJECTED_BY_SHOP','NOT_COMPLETED'))),
 ADD CONSTRAINT orders_system_cancel_ck CHECK(status<>'CANCELLED_BY_SYSTEM' OR (end_actor='SYSTEM' AND end_reason IS NOT NULL AND btrim(end_reason)<>''));
ALTER TABLE app.deliveries DROP CONSTRAINT deliveries_state_ck, DROP CONSTRAINT deliveries_ended_ck;
ALTER TABLE app.deliveries ADD CONSTRAINT deliveries_state_ck CHECK(state IN ('waiting_driver','accepted','location_confirmed','picked_up','delivering','completed','failed','cancelled_by_merchant','cancelled_by_system','search_stopped')),
 ADD CONSTRAINT deliveries_ended_ck CHECK((state IN ('completed','failed','cancelled_by_merchant','cancelled_by_system','search_stopped'))=(ended_at IS NOT NULL));
ALTER TABLE app.delivery_assignments DROP CONSTRAINT delivery_assignments_status_ck;
ALTER TABLE app.delivery_assignments ADD CONSTRAINT delivery_assignments_status_ck CHECK(status IN ('ACTIVE','COMPLETED','FAILED','CANCELLED_BY_SHIPPER','CANCELLED_BY_SHOP','CANCELLED_BY_SYSTEM','RELEASED_BY_ADMIN'));
CREATE OR REPLACE FUNCTION app.orders_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.orders is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.order_id <> OLD.order_id OR NEW.code <> OLD.code OR NEW.client_ref <> OLD.client_ref OR NEW.customer_user_id <> OLD.customer_user_id
     OR NEW.shop_id <> OLD.shop_id OR NEW.shop_name <> OLD.shop_name OR NEW.shop_phone <> OLD.shop_phone OR NEW.shop_address_text <> OLD.shop_address_text
     OR NEW.recipient_name <> OLD.recipient_name OR NEW.recipient_phone <> OLD.recipient_phone OR NEW.address_text <> OLD.address_text
     OR NEW.address_lat IS DISTINCT FROM OLD.address_lat OR NEW.address_lng IS DISTINCT FROM OLD.address_lng
     OR NEW.source_address_id IS DISTINCT FROM OLD.source_address_id OR NEW.note IS DISTINCT FROM OLD.note OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
     OR NEW.items_original_total_vnd <> OLD.items_original_total_vnd OR NEW.fee_estimate_vnd IS DISTINCT FROM OLD.fee_estimate_vnd
     OR NEW.fee_estimate_distance_m IS DISTINCT FROM OLD.fee_estimate_distance_m OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'ORDER_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'ORDER_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PENDING_CONFIRMATION' AND NEW.status IN ('PREPARING', 'CANCELLED_BY_CUSTOMER', 'REJECTED_BY_SHOP','CANCELLED_BY_SYSTEM'))
    OR (OLD.status = 'PREPARING' AND NEW.status IN ('COMPLETED', 'CANCELLED_BY_SHOP', 'NOT_COMPLETED','CANCELLED_BY_SYSTEM'))
  ) THEN
    RAISE EXCEPTION 'ORDER_STATE_TRANSITION: % -> %', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status='CANCELLED_BY_SYSTEM' AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
    RAISE EXCEPTION 'ORDER_CONFIRMATION_IMMUTABLE' USING ERRCODE='restrict_violation';
  END IF;
  -- A finished Order changes nothing.
  IF OLD.status IN ('COMPLETED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SHOP', 'REJECTED_BY_SHOP', 'NOT_COMPLETED','CANCELLED_BY_SYSTEM') THEN
    RAISE EXCEPTION 'ORDER_TERMINAL' USING ERRCODE = 'restrict_violation';
  END IF;
  -- The dishes and the amount are locked once the shop confirmed; the paid amount is recorded only on a confirmed, running Order.
  IF OLD.status <> 'PENDING_CONFIRMATION' AND (NEW.items_total_vnd <> OLD.items_total_vnd OR NEW.edited_at IS DISTINCT FROM OLD.edited_at) THEN
    RAISE EXCEPTION 'ORDER_ITEMS_LOCKED' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.paid_vnd <> OLD.paid_vnd AND NOT (OLD.status = 'PREPARING' AND NEW.status = 'PREPARING') THEN
    RAISE EXCEPTION 'ORDER_PAYMENT_NOT_ALLOWED' USING ERRCODE = 'restrict_violation';
  END IF;
  -- An Order is never confirmed empty.
  IF NEW.status = 'PREPARING' AND OLD.status = 'PENDING_CONFIRMATION' AND (
       NEW.items_total_vnd < 1 OR NOT EXISTS (SELECT 1 FROM app.order_items i WHERE i.order_id = NEW.order_id AND i.removed_at IS NULL)
     ) THEN
    RAISE EXCEPTION 'ORDER_EMPTY_CONFIRMATION' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION app.deliveries_guard() RETURNS trigger
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
       (OLD.state = 'waiting_driver' AND NEW.state IN ('accepted', 'cancelled_by_merchant','cancelled_by_system','search_stopped'))
    OR (OLD.state = 'accepted' AND NEW.state IN ('location_confirmed', 'waiting_driver', 'search_stopped', 'cancelled_by_merchant','cancelled_by_system','delivering'))
    OR (OLD.state = 'location_confirmed' AND NEW.state IN ('waiting_driver', 'search_stopped', 'cancelled_by_merchant','cancelled_by_system','delivering'))
    OR (OLD.state = 'delivering' AND NEW.state IN ('completed', 'failed'))
    OR (OLD.state = 'search_stopped' AND NEW.state IN ('cancelled_by_merchant','cancelled_by_system'))
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
  IF OLD.state IN ('completed', 'failed','cancelled_by_merchant','cancelled_by_system') AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'DELIVERY_TERMINAL' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION app.m10_assert_order(target_order uuid) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  o app.orders%ROWTYPE;
  original_sum bigint;
  current_sum bigint;
  active_deliveries integer;
  completed_deliveries integer;
  foreign_deliveries integer;
BEGIN
  SELECT * INTO o FROM app.orders WHERE order_id = target_order;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT COALESCE(sum(orig_unit_price_vnd * orig_quantity), 0), COALESCE(sum(unit_price_vnd * quantity) FILTER (WHERE removed_at IS NULL), 0)
    INTO original_sum, current_sum FROM app.order_items WHERE order_id = target_order;
  IF original_sum <> o.items_original_total_vnd OR current_sum <> o.items_total_vnd THEN
    RAISE EXCEPTION 'ORDER_INVARIANT_VIOLATION: the amounts do not equal the lines' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT count(*) FILTER (WHERE state IN ('waiting_driver', 'accepted', 'location_confirmed', 'picked_up', 'delivering')),
         count(*) FILTER (WHERE state = 'completed'),
         count(*) FILTER (WHERE shop_id <> o.shop_id)
    INTO active_deliveries, completed_deliveries, foreign_deliveries FROM app.deliveries WHERE order_id = target_order;
  IF foreign_deliveries > 0 OR (active_deliveries + completed_deliveries + foreign_deliveries > 0 AND o.status = 'PENDING_CONFIRMATION') THEN
    RAISE EXCEPTION 'ORDER_INVARIANT_VIOLATION: a delivery exists for an order that is not confirmed or belongs to another shop' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF o.status IN ('CANCELLED_BY_SHOP', 'NOT_COMPLETED', 'CANCELLED_BY_CUSTOMER', 'REJECTED_BY_SHOP','CANCELLED_BY_SYSTEM') AND active_deliveries > 0 THEN
    RAISE EXCEPTION 'ORDER_INVARIANT_VIOLATION: an ended order still has an active delivery' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF o.status = 'COMPLETED' AND (completed_deliveries <> 1 OR active_deliveries > 0) THEN
    RAISE EXCEPTION 'ORDER_INVARIANT_VIOLATION: a completed order needs exactly one completed delivery' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END;
$$;

-- Safe before/after facts, joined by resource/version to existing event/audit actor and correlation records.
CREATE TABLE app.cancellation_transitions (
 transition_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, resource_type text NOT NULL,resource_id uuid NOT NULL,resource_version bigint NOT NULL,
 order_id uuid,delivery_id uuid,assignment_id uuid,before_state text NOT NULL,after_state text NOT NULL,reason text,actor_type text,
 source text NOT NULL,request_id text,rule_snapshot jsonb,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(resource_type,resource_id,resource_version)
);
CREATE FUNCTION app.record_cancellation_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b jsonb:=to_jsonb(OLD);a jsonb:=to_jsonb(NEW);prev text;next text;
BEGIN
 prev:=coalesce(b->>'status',b->>'state');next:=coalesce(a->>'status',a->>'state');
 IF prev IS DISTINCT FROM next AND (next LIKE 'CANCELLED%' OR next LIKE 'cancelled%' OR next IN ('RELEASED_BY_ADMIN','search_stopped','REJECTED_BY_SHOP')) THEN
  INSERT INTO app.cancellation_transitions(resource_type,resource_id,resource_version,order_id,delivery_id,assignment_id,before_state,after_state,reason,actor_type,source,request_id,rule_snapshot)
  VALUES(TG_TABLE_NAME,coalesce(a->>'assignment_id',a->>'delivery_id',a->>'order_id')::uuid,NEW.version,
   (a->>'order_id')::uuid,(a->>'delivery_id')::uuid,(a->>'assignment_id')::uuid,prev,next,a->>'end_reason',a->>'end_actor',
   coalesce(nullif(current_setting('app.cancellation_source',true),''),'manual'),current_setting('app.cancellation_request_id',true),a->'timeout_snapshot');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cancellation_transition_orders AFTER UPDATE ON app.orders FOR EACH ROW EXECUTE FUNCTION app.record_cancellation_transition();
CREATE TRIGGER cancellation_transition_deliveries AFTER UPDATE ON app.deliveries FOR EACH ROW EXECUTE FUNCTION app.record_cancellation_transition();
CREATE TRIGGER cancellation_transition_assignments AFTER UPDATE ON app.delivery_assignments FOR EACH ROW EXECUTE FUNCTION app.record_cancellation_transition();
CREATE TRIGGER cancellation_transitions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON app.cancellation_transitions FOR EACH STATEMENT EXECUTE FUNCTION app.order_events_reject_mutation();
CREATE INDEX orders_timeout_pending_idx ON app.orders(timeout_next_reminder_at) WHERE status='PENDING_CONFIRMATION' AND timeout_snapshot IS NOT NULL;
CREATE INDEX deliveries_timeout_idx ON app.deliveries(order_id) WHERE state IN ('waiting_driver','search_stopped','accepted','location_confirmed');
-- Down Migration
-- Preserve immutable history; use a corrective migration after release.
DO $$ BEGIN RAISE EXCEPTION 'Issue 153: rollback requires a forward corrective migration'; END $$;
