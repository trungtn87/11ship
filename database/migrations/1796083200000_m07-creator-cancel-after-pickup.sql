-- Up Migration
-- M07 Owner decision 2026-10-23 (docs/current/M07-owner-delivery-flow-20261023.md): after the goods are picked up the Shipper can no longer cancel or
-- report a failure; only the CREATOR of the request can cancel (ORDER: the customer who placed it, DIRECT: the shop). Forward-only: nothing already
-- deployed is edited, existing rows are untouched, constraints are only widened.

-- A delivery that is `delivering` may now also end as cancelled by its creator (the goods stay the Shipper's responsibility: an OPEN goods incident
-- is written by the application in the same transaction).
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
    OR (OLD.state = 'delivering' AND NEW.state IN ('completed', 'failed', 'cancelled_by_merchant'))
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

-- A delivery cancelled after pickup keeps the time the goods were picked up. The drop-off MAP POINT is no longer needed for a pickup (an address is enough:
-- Owner decision 2026-10-23); the fee still is.
ALTER TABLE app.deliveries DROP CONSTRAINT deliveries_pickup_ck;
ALTER TABLE app.deliveries ADD CONSTRAINT deliveries_pickup_ck CHECK (
  (
    (state IN ('picked_up', 'delivering', 'completed', 'failed')) = (picked_up_at IS NOT NULL)
    OR (state = 'cancelled_by_merchant' AND picked_up_at IS NOT NULL)
  )
  AND (picked_up_at IS NULL OR fee_vnd IS NOT NULL)
);

-- The customer who placed an ORDER is a recorded actor of the delivery and of the assignment that ends because they cancelled.
ALTER TABLE app.delivery_events DROP CONSTRAINT delivery_events_actor_ck;
ALTER TABLE app.delivery_events ADD CONSTRAINT delivery_events_actor_ck CHECK (actor_type IN ('SHOP', 'SHIPPER', 'ADMIN', 'SYSTEM', 'CUSTOMER'));
ALTER TABLE app.delivery_assignments DROP CONSTRAINT delivery_assignments_status_ck, DROP CONSTRAINT delivery_assignments_ended_ck;
ALTER TABLE app.delivery_assignments ADD CONSTRAINT delivery_assignments_status_ck
  CHECK (status IN ('ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED_BY_SHIPPER', 'CANCELLED_BY_SHOP', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SYSTEM', 'RELEASED_BY_ADMIN'));
ALTER TABLE app.delivery_assignments ADD CONSTRAINT delivery_assignments_ended_ck CHECK (
  (status = 'ACTIVE') = (ended_at IS NULL)
  AND (ended_at IS NULL) = (end_actor IS NULL)
  AND (end_actor IS NULL OR end_actor IN ('SHIPPER', 'SHOP', 'ADMIN', 'SYSTEM', 'CUSTOMER'))
);

-- The customer may end a CONFIRMED order (after pickup), which until now only the shop, the system or completion could do. The confirmation time is
-- kept (the shop did confirm), so the confirmed_at rule admits CANCELLED_BY_CUSTOMER both with and without it.
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
    OR (OLD.status = 'PREPARING' AND NEW.status IN ('COMPLETED', 'CANCELLED_BY_SHOP', 'CANCELLED_BY_CUSTOMER', 'NOT_COMPLETED','CANCELLED_BY_SYSTEM'))
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
ALTER TABLE app.orders DROP CONSTRAINT orders_confirmed_ck;
ALTER TABLE app.orders ADD CONSTRAINT orders_confirmed_ck CHECK (
  CASE
    WHEN status IN ('CANCELLED_BY_SYSTEM', 'CANCELLED_BY_CUSTOMER') THEN true
    ELSE (confirmed_at IS NOT NULL) = (status IN ('PREPARING', 'COMPLETED', 'CANCELLED_BY_SHOP', 'NOT_COMPLETED'))
  END
);
-- A customer who cancels a confirmed order gives a reason (an unconfirmed order keeps the old, reason-optional rule).
ALTER TABLE app.orders ADD CONSTRAINT orders_customer_cancel_after_confirm_ck CHECK (
  status <> 'CANCELLED_BY_CUSTOMER' OR confirmed_at IS NULL OR (end_reason IS NOT NULL AND btrim(end_reason) <> '')
);

-- Down Migration
-- Preserve immutable history; use a corrective migration after release.
DO $$ BEGIN RAISE EXCEPTION 'M07 2026-10-23: rollback requires a forward corrective migration'; END $$;
