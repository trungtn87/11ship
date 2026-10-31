-- Up Migration
-- Nhóm 09 (issues #221, #212): Gọi shipper dùng chung cho khách, thu hộ (COD), theo dõi không cần tài khoản và tối ưu nhận chuyến.

ALTER TABLE app.deliveries DROP CONSTRAINT deliveries_source_ck;
ALTER TABLE app.deliveries ADD CONSTRAINT deliveries_source_ck CHECK (source IN ('DIRECT', 'ORDER', 'CUSTOMER'));

ALTER TABLE app.deliveries ALTER COLUMN shop_id DROP NOT NULL;
ALTER TABLE app.deliveries ALTER COLUMN pickup_lat DROP NOT NULL;
ALTER TABLE app.deliveries ALTER COLUMN pickup_lng DROP NOT NULL;

ALTER TABLE app.deliveries DROP CONSTRAINT deliveries_pickup_point_ck;
ALTER TABLE app.deliveries ADD CONSTRAINT deliveries_pickup_point_ck CHECK (
  (pickup_lat IS NULL) = (pickup_lng IS NULL)
  AND (pickup_lat IS NULL OR (pickup_lat BETWEEN -90 AND 90 AND pickup_lng BETWEEN -180 AND 180))
);

ALTER TABLE app.deliveries ADD COLUMN cod_vnd bigint NOT NULL DEFAULT 0;
ALTER TABLE app.deliveries ADD CONSTRAINT deliveries_cod_ck CHECK (cod_vnd >= 0 AND cod_vnd <= 10000000);

ALTER TABLE app.deliveries ALTER COLUMN fee_payer TYPE varchar(16);
ALTER TABLE app.deliveries DROP CONSTRAINT deliveries_fee_payer_ck;
ALTER TABLE app.deliveries ADD CONSTRAINT deliveries_fee_payer_ck CHECK (fee_payer IN ('CUSTOMER', 'SHOP', 'SENDER', 'RECIPIENT'));

ALTER TABLE app.shipping_fee_agreement_events ALTER COLUMN fee_payer TYPE varchar(16);
ALTER TABLE app.shipping_fee_agreement_events DROP CONSTRAINT IF EXISTS shipping_fee_agreement_events_fee_payer_ck;
ALTER TABLE app.shipping_fee_agreement_events ADD CONSTRAINT shipping_fee_agreement_events_fee_payer_ck CHECK (fee_payer IS NULL OR fee_payer IN ('CUSTOMER', 'SHOP', 'SENDER', 'RECIPIENT'));

CREATE OR REPLACE FUNCTION app.deliveries_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  adjust boolean := COALESCE(current_setting('app.m07_admin_adjust', true), '') = 'on';
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.deliveries is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.delivery_id <> OLD.delivery_id OR NEW.code <> OLD.code OR NEW.source <> OLD.source OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.previous_delivery_id IS DISTINCT FROM OLD.previous_delivery_id OR NEW.shop_id IS DISTINCT FROM OLD.shop_id OR NEW.requested_by <> OLD.requested_by
     OR NEW.shop_name <> OLD.shop_name OR NEW.shop_phone <> OLD.shop_phone OR NEW.pickup_address_text <> OLD.pickup_address_text
     OR NEW.pickup_lat IS DISTINCT FROM OLD.pickup_lat OR NEW.pickup_lng IS DISTINCT FROM OLD.pickup_lng OR NEW.recipient_name <> OLD.recipient_name
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

CREATE TABLE app.delivery_tracking_links (
  tracking_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  token_hash varchar(64) NOT NULL,
  share_location boolean NOT NULL DEFAULT false,
  revoked boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT delivery_tracking_links_pkey PRIMARY KEY (tracking_id),
  CONSTRAINT delivery_tracking_links_token_hash_uq UNIQUE (token_hash),
  CONSTRAINT delivery_tracking_links_delivery_fk FOREIGN KEY (delivery_id) REFERENCES app.deliveries (delivery_id) ON DELETE RESTRICT
);
CREATE INDEX delivery_tracking_links_delivery_idx ON app.delivery_tracking_links (delivery_id);

-- Down Migration
DROP TABLE IF EXISTS app.delivery_tracking_links;
ALTER TABLE app.deliveries DROP CONSTRAINT IF EXISTS deliveries_cod_ck;
ALTER TABLE app.deliveries DROP COLUMN IF EXISTS cod_vnd;
ALTER TABLE app.deliveries DROP CONSTRAINT IF EXISTS deliveries_source_ck;
ALTER TABLE app.deliveries ADD CONSTRAINT deliveries_source_ck CHECK (source IN ('DIRECT', 'ORDER'));
