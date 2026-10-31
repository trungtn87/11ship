-- Up Migration
-- Issue #238 (Owner 2026-10-31): the customer may edit their own Order while it waits for the shop to confirm. The Order keeps its identity, its shop snapshot, its wanted time,
-- its code and its timeout clock; what the customer sent (dishes, note, recipient, address, the fee estimate shown) is replaced by the new version.
--  * app.orders.customer_edited_at / customer_edit_count: when and how many times (the shop is told "Khách vừa cập nhật đơn hàng").
--  * app.order_items.superseded_at: a line the customer replaced. It stays in the table (history, never deleted) but no longer counts: not in the amounts, not in the views.
--    A new version of the dishes is inserted as new lines (original = current), so the "original" the shop compares with is what the customer last sent.
--  * The guard of app.orders lets the snapshot fields change ONLY inside the customer's edit (setting app.customer_order_edit = 'on', PENDING -> PENDING, same transaction).
--    The history of every version stays in app.order_events (before / after), which is append-only.

ALTER TABLE app.orders ADD COLUMN customer_edited_at timestamptz;
ALTER TABLE app.orders ADD COLUMN customer_edit_count integer NOT NULL DEFAULT 0;
ALTER TABLE app.orders ADD CONSTRAINT orders_customer_edit_ck CHECK (customer_edit_count BETWEEN 0 AND 50 AND (customer_edit_count = 0) = (customer_edited_at IS NULL));

ALTER TABLE app.order_items ADD COLUMN superseded_at timestamptz;
ALTER TABLE app.order_items DROP CONSTRAINT order_items_line_no_ck;
ALTER TABLE app.order_items ADD CONSTRAINT order_items_line_no_ck CHECK (line_no BETWEEN 1 AND 2000);

CREATE OR REPLACE FUNCTION app.orders_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  allow_address_change boolean := COALESCE(current_setting('app.address_change_in_progress', true), '') = 'on';
  customer_edit boolean := COALESCE(current_setting('app.customer_order_edit', true), '') = 'on';
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.orders is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF customer_edit AND NOT (OLD.status = 'PENDING_CONFIRMATION' AND NEW.status = 'PENDING_CONFIRMATION' AND NEW.customer_edit_count = OLD.customer_edit_count + 1) THEN
    RAISE EXCEPTION 'ORDER_CUSTOMER_EDIT_NOT_ALLOWED' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.order_id <> OLD.order_id OR NEW.code <> OLD.code OR NEW.client_ref <> OLD.client_ref OR NEW.customer_user_id <> OLD.customer_user_id
     OR NEW.shop_id <> OLD.shop_id OR NEW.shop_name <> OLD.shop_name OR NEW.shop_phone <> OLD.shop_phone OR NEW.shop_address_text <> OLD.shop_address_text
     OR (NOT (allow_address_change OR customer_edit) AND (
           NEW.recipient_name <> OLD.recipient_name OR NEW.recipient_phone <> OLD.recipient_phone OR NEW.address_text <> OLD.address_text
           OR NEW.address_lat IS DISTINCT FROM OLD.address_lat OR NEW.address_lng IS DISTINCT FROM OLD.address_lng
           OR NEW.fee_estimate_vnd IS DISTINCT FROM OLD.fee_estimate_vnd OR NEW.fee_estimate_distance_m IS DISTINCT FROM OLD.fee_estimate_distance_m
        ))
     OR (NOT customer_edit AND (
           NEW.source_address_id IS DISTINCT FROM OLD.source_address_id OR NEW.note IS DISTINCT FROM OLD.note
           OR NEW.items_original_total_vnd <> OLD.items_original_total_vnd
           OR NEW.customer_edit_count <> OLD.customer_edit_count OR NEW.customer_edited_at IS DISTINCT FROM OLD.customer_edited_at
        ))
     OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for OR NEW.created_at <> OLD.created_at THEN
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
       NEW.items_total_vnd < 1 OR NOT EXISTS (SELECT 1 FROM app.order_items i WHERE i.order_id = NEW.order_id AND i.removed_at IS NULL AND i.superseded_at IS NULL)
     ) THEN
    RAISE EXCEPTION 'ORDER_EMPTY_CONFIRMATION' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.order_items_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  parent_status varchar;
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'app.order_items is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT o.status INTO parent_status FROM app.orders o WHERE o.order_id = NEW.order_id;
  IF TG_OP = 'INSERT' THEN
    IF parent_status IS DISTINCT FROM 'PENDING_CONFIRMATION' OR NEW.removed_at IS NOT NULL OR NEW.superseded_at IS NOT NULL
       OR NEW.unit_price_vnd <> NEW.orig_unit_price_vnd OR NEW.quantity <> NEW.orig_quantity THEN
      RAISE EXCEPTION 'ORDER_ITEMS_LOCKED' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.line_id <> OLD.line_id OR NEW.order_id <> OLD.order_id OR NEW.line_no <> OLD.line_no OR NEW.menu_item_id <> OLD.menu_item_id OR NEW.name <> OLD.name
     OR NEW.note IS DISTINCT FROM OLD.note OR NEW.orig_unit_price_vnd <> OLD.orig_unit_price_vnd OR NEW.orig_quantity <> OLD.orig_quantity OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'ORDER_ITEM_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF parent_status IS DISTINCT FROM 'PENDING_CONFIRMATION' THEN
    RAISE EXCEPTION 'ORDER_ITEMS_LOCKED' USING ERRCODE = 'restrict_violation';
  END IF;
  -- A replaced line is history: it never changes again. Being replaced is one-way and changes nothing else on the line.
  IF OLD.superseded_at IS NOT NULL OR (NEW.superseded_at IS NOT NULL AND (NEW.quantity <> OLD.quantity OR NEW.unit_price_vnd <> OLD.unit_price_vnd OR NEW.removed_at IS DISTINCT FROM OLD.removed_at)) THEN
    RAISE EXCEPTION 'ORDER_ITEMS_LOCKED' USING ERRCODE = 'restrict_violation';
  END IF;
  -- A removed line stays removed.
  IF OLD.removed_at IS NOT NULL AND (NEW.removed_at IS DISTINCT FROM OLD.removed_at OR NEW.quantity <> OLD.quantity OR NEW.unit_price_vnd <> OLD.unit_price_vnd) THEN
    RAISE EXCEPTION 'ORDER_ITEMS_LOCKED' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- The drop-off note of the Order is a snapshot too; it may change only inside the customer's edit (same switch).
CREATE OR REPLACE FUNCTION app.address_note_snapshot_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'orders' AND to_jsonb(NEW)->'delivery_note' IS DISTINCT FROM to_jsonb(OLD)->'delivery_note'
     AND COALESCE(current_setting('app.customer_order_edit', true), '') <> 'on' THEN
    RAISE EXCEPTION 'ORDER_DELIVERY_NOTE_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_TABLE_NAME = 'deliveries' AND to_jsonb(NEW)->'dropoff_note' IS DISTINCT FROM to_jsonb(OLD)->'dropoff_note' THEN
    RAISE EXCEPTION 'DELIVERY_DROPOFF_NOTE_IMMUTABLE' USING ERRCODE = 'restrict_violation';
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
    INTO original_sum, current_sum FROM app.order_items WHERE order_id = target_order AND superseded_at IS NULL;
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

-- Down Migration
-- Not reversible once an Order carries a customer edit (its replaced lines would be counted again against the old amounts): refused then.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.orders WHERE customer_edit_count > 0) THEN
    RAISE EXCEPTION 'order customer edit: cannot go down while an edited order exists';
  END IF;
END
$$;
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
CREATE OR REPLACE FUNCTION app.order_items_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  parent_status varchar;
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'app.order_items is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT o.status INTO parent_status FROM app.orders o WHERE o.order_id = NEW.order_id;
  IF TG_OP = 'INSERT' THEN
    IF parent_status IS DISTINCT FROM 'PENDING_CONFIRMATION' OR NEW.removed_at IS NOT NULL
       OR NEW.unit_price_vnd <> NEW.orig_unit_price_vnd OR NEW.quantity <> NEW.orig_quantity THEN
      RAISE EXCEPTION 'ORDER_ITEMS_LOCKED' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.line_id <> OLD.line_id OR NEW.order_id <> OLD.order_id OR NEW.line_no <> OLD.line_no OR NEW.menu_item_id <> OLD.menu_item_id OR NEW.name <> OLD.name
     OR NEW.note IS DISTINCT FROM OLD.note OR NEW.orig_unit_price_vnd <> OLD.orig_unit_price_vnd OR NEW.orig_quantity <> OLD.orig_quantity OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'ORDER_ITEM_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF parent_status IS DISTINCT FROM 'PENDING_CONFIRMATION' THEN
    RAISE EXCEPTION 'ORDER_ITEMS_LOCKED' USING ERRCODE = 'restrict_violation';
  END IF;
  -- A removed line stays removed.
  IF OLD.removed_at IS NOT NULL AND (NEW.removed_at IS DISTINCT FROM OLD.removed_at OR NEW.quantity <> OLD.quantity OR NEW.unit_price_vnd <> OLD.unit_price_vnd) THEN
    RAISE EXCEPTION 'ORDER_ITEMS_LOCKED' USING ERRCODE = 'restrict_violation';
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
CREATE OR REPLACE FUNCTION app.address_note_snapshot_guard() RETURNS trigger
  LANGUAGE plpgsql AS $
BEGIN
  IF TG_TABLE_NAME = 'orders' AND to_jsonb(NEW)->'delivery_note' IS DISTINCT FROM to_jsonb(OLD)->'delivery_note' THEN
    RAISE EXCEPTION 'ORDER_DELIVERY_NOTE_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_TABLE_NAME = 'deliveries' AND to_jsonb(NEW)->'dropoff_note' IS DISTINCT FROM to_jsonb(OLD)->'dropoff_note' THEN
    RAISE EXCEPTION 'DELIVERY_DROPOFF_NOTE_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$;
ALTER TABLE app.order_items DROP CONSTRAINT order_items_line_no_ck;
ALTER TABLE app.order_items ADD CONSTRAINT order_items_line_no_ck CHECK (line_no BETWEEN 1 AND 40);
ALTER TABLE app.order_items DROP COLUMN superseded_at;
ALTER TABLE app.orders DROP CONSTRAINT orders_customer_edit_ck;
ALTER TABLE app.orders DROP COLUMN customer_edit_count;
ALTER TABLE app.orders DROP COLUMN customer_edited_at;
