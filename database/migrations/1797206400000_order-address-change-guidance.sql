-- Up Migration
-- Nhóm 10 (issues #218, #217): Xin đổi địa chỉ sau xác nhận và hướng dẫn xử lý sự cố trong đơn.

CREATE TABLE app.address_change_requests (
  change_request_id uuid NOT NULL,
  order_id uuid,
  delivery_id uuid,
  source varchar(16) NOT NULL,
  requested_by uuid NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'PENDING',
  target_actor varchar(16) NOT NULL,
  target_driver_id uuid,
  original_recipient_name varchar(80) NOT NULL,
  original_recipient_phone varchar(20) NOT NULL,
  original_address_text varchar(300) NOT NULL,
  original_lat double precision,
  original_lng double precision,
  original_fee_vnd bigint,
  original_distance_m integer,
  new_recipient_name varchar(80) NOT NULL,
  new_recipient_phone varchar(20) NOT NULL,
  new_address_text varchar(300) NOT NULL,
  new_lat double precision,
  new_lng double precision,
  new_fee_vnd bigint,
  new_distance_m integer,
  fee_difference_vnd bigint,
  note varchar(200),
  reject_reason varchar(200),
  resolved_by uuid,
  resolved_at timestamptz,
  expires_at timestamptz NOT NULL,
  order_version bigint,
  delivery_version bigint,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT address_change_requests_pkey PRIMARY KEY (change_request_id),
  CONSTRAINT address_change_requests_order_fk FOREIGN KEY (order_id) REFERENCES app.orders (order_id) ON DELETE RESTRICT,
  CONSTRAINT address_change_requests_delivery_fk FOREIGN KEY (delivery_id) REFERENCES app.deliveries (delivery_id) ON DELETE RESTRICT,
  CONSTRAINT address_change_requests_requester_fk FOREIGN KEY (requested_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT address_change_requests_driver_fk FOREIGN KEY (target_driver_id) REFERENCES app.drivers (driver_id) ON DELETE RESTRICT,
  CONSTRAINT address_change_requests_resolver_fk FOREIGN KEY (resolved_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT address_change_requests_source_ck CHECK (source IN ('ORDER', 'CUSTOMER')),
  CONSTRAINT address_change_requests_status_ck CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED')),
  CONSTRAINT address_change_requests_target_actor_ck CHECK (target_actor IN ('SHOP', 'SHIPPER')),
  CONSTRAINT address_change_requests_orig_point_ck CHECK (
    (original_lat IS NULL) = (original_lng IS NULL)
    AND (original_lat IS NULL OR (original_lat BETWEEN -90 AND 90 AND original_lng BETWEEN -180 AND 180))
  ),
  CONSTRAINT address_change_requests_new_point_ck CHECK (
    (new_lat IS NULL) = (new_lng IS NULL)
    AND (new_lat IS NULL OR (new_lat BETWEEN -90 AND 90 AND new_lng BETWEEN -180 AND 180))
  ),
  CONSTRAINT address_change_requests_version_ck CHECK (version >= 1),
  CONSTRAINT address_change_requests_time_ck CHECK (updated_at >= created_at AND expires_at >= created_at)
);

CREATE UNIQUE INDEX address_change_active_order_uq ON app.address_change_requests (order_id)
  WHERE order_id IS NOT NULL AND status = 'PENDING';

CREATE UNIQUE INDEX address_change_active_delivery_uq ON app.address_change_requests (delivery_id)
  WHERE delivery_id IS NOT NULL AND status = 'PENDING';

CREATE INDEX address_change_requests_order_idx ON app.address_change_requests (order_id, created_at DESC)
  WHERE order_id IS NOT NULL;

CREATE INDEX address_change_requests_delivery_idx ON app.address_change_requests (delivery_id, created_at DESC)
  WHERE delivery_id IS NOT NULL;

-- Cập nhật app.orders_guard để cho phép cập nhật snapshot địa chỉ khi có phiên đổi địa chỉ hợp lệ
CREATE OR REPLACE FUNCTION app.orders_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  allow_address_change boolean := COALESCE(current_setting('app.address_change_in_progress', true), '') = 'on';
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.orders is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.order_id <> OLD.order_id OR NEW.code <> OLD.code OR NEW.client_ref <> OLD.client_ref OR NEW.customer_user_id <> OLD.customer_user_id
     OR NEW.shop_id <> OLD.shop_id OR NEW.shop_name <> OLD.shop_name OR NEW.shop_phone <> OLD.shop_phone OR NEW.shop_address_text <> OLD.shop_address_text
     OR (NOT allow_address_change AND (
           NEW.recipient_name <> OLD.recipient_name OR NEW.recipient_phone <> OLD.recipient_phone OR NEW.address_text <> OLD.address_text
           OR NEW.address_lat IS DISTINCT FROM OLD.address_lat OR NEW.address_lng IS DISTINCT FROM OLD.address_lng
           OR NEW.fee_estimate_vnd IS DISTINCT FROM OLD.fee_estimate_vnd OR NEW.fee_estimate_distance_m IS DISTINCT FROM OLD.fee_estimate_distance_m
        ))
     OR NEW.source_address_id IS DISTINCT FROM OLD.source_address_id OR NEW.note IS DISTINCT FROM OLD.note OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
     OR NEW.items_original_total_vnd <> OLD.items_original_total_vnd OR NEW.created_at <> OLD.created_at THEN
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

-- Cập nhật app.deliveries_guard để cho phép cập nhật recipient_name khi có phiên đổi địa chỉ hợp lệ
CREATE OR REPLACE FUNCTION app.deliveries_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  adjust boolean := COALESCE(current_setting('app.m07_admin_adjust', true), '') = 'on';
  allow_address_change boolean := COALESCE(current_setting('app.address_change_in_progress', true), '') = 'on';
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.deliveries is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.delivery_id <> OLD.delivery_id OR NEW.code <> OLD.code OR NEW.source <> OLD.source OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.previous_delivery_id IS DISTINCT FROM OLD.previous_delivery_id OR NEW.shop_id IS DISTINCT FROM OLD.shop_id OR NEW.requested_by <> OLD.requested_by
     OR NEW.shop_name <> OLD.shop_name OR NEW.shop_phone <> OLD.shop_phone OR NEW.pickup_address_text <> OLD.pickup_address_text
     OR NEW.pickup_lat IS DISTINCT FROM OLD.pickup_lat OR NEW.pickup_lng IS DISTINCT FROM OLD.pickup_lng
     OR (NOT allow_address_change AND NEW.recipient_name <> OLD.recipient_name)
     OR NEW.goods_description <> OLD.goods_description OR NEW.goods_value_vnd <> OLD.goods_value_vnd OR NEW.paid_vnd <> OLD.paid_vnd
     OR NEW.fee_mode <> OLD.fee_mode OR NEW.fee_payer <> OLD.fee_payer OR NEW.cod_vnd <> OLD.cod_vnd
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
       OR NEW.dropoff_address_text <> OLD.dropoff_address_text OR NEW.recipient_phone <> OLD.recipient_phone OR NEW.recipient_name <> OLD.recipient_name OR NEW.picked_up_at IS DISTINCT FROM OLD.picked_up_at
  ) THEN
    RAISE EXCEPTION 'DELIVERY_FEE_LOCKED' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.state IN ('completed', 'failed','cancelled_by_merchant','cancelled_by_system') AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'DELIVERY_TERMINAL' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Down Migration
DROP TABLE IF EXISTS app.address_change_requests;
