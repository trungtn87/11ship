-- Up Migration
-- Owner decision 2026-11-22 (Apple 5.1.1(v)): the owner's own deletion ANONYMIZES the account in place instead of only locking it when data
-- must be kept. ADDITIVE only: no earlier migration, no enum and no lock_reason constraint is edited.
--
--  * app.users.anonymized_at: set when app.anonymize_app_user has removed the personal data of the account. The account stays as a
--    DISABLED / DELETE_REQUEST tombstone under the same user_id, so every order, delivery, wallet, ledger and review keeps its link. The phone
--    number is replaced by a unique placeholder, which frees the real number for a new registration. The password hash is replaced by an
--    unusable one. users_anonymized_ck: an anonymized row can never become ACTIVE again (the database refuses it).
--  * app.anonymized_phone_number() and app.account_anonymized_phone_seq: placeholder numbers "+999" + 11 digits (unique, valid for users_phone_normalized_ck).
--  * app.anonymize_app_user(user_id, password_hash): ONE transaction. It deletes sessions, device bindings and keys, saved addresses, carts,
--    profile, push tokens and subscriptions, notifications and their pushes / reminders / settings, bank account rows; and scrubs the personal
--    snapshots (names, phones, addresses, coordinates) of the account's orders, deliveries, address change requests, shops and driver profile.
--    It NEVER deletes an order, delivery, wallet, ledger, withdrawal, review, complaint or consent row.
--  * orders_guard / deliveries_guard: ONE exception, active only while app.anonymize_app_user runs (transaction setting
--    app.account_anonymize = 'on') and only for a write that changes the personal columns and nothing else. Every other write still meets every
--    rule of these guards (identity, state, money, notes, version, terminal rows) exactly as before.


ALTER TABLE app.users ADD COLUMN anonymized_at timestamptz;
ALTER TABLE app.users ADD CONSTRAINT users_anonymized_ck CHECK (
  anonymized_at IS NULL OR (status = 'DISABLED' AND lock_reason = 'DELETE_REQUEST' AND delete_requested_at IS NULL)
);

CREATE SEQUENCE app.account_anonymized_phone_seq AS bigint START 1 MINVALUE 1;
REVOKE ALL ON SEQUENCE app.account_anonymized_phone_seq FROM PUBLIC;

CREATE FUNCTION app.anonymized_phone_number() RETURNS text
  LANGUAGE sql VOLATILE SET search_path = app, pg_temp AS $$
  SELECT '+999' || lpad(nextval('app.account_anonymized_phone_seq')::text, 11, '0')
$$;
REVOKE ALL ON FUNCTION app.anonymized_phone_number() FROM PUBLIC;

CREATE FUNCTION app.anonymize_app_user(p_user_id uuid, p_password_hash text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_phone text;
  v_keys uuid[];
  v_shop record;
  v_driver_id uuid;
BEGIN
  PERFORM 1 FROM app.users WHERE user_id = p_user_id AND account_scope = 'APP_USER' AND anonymized_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM set_config('app.account_anonymize', 'on', true);
  v_phone := app.anonymized_phone_number();

  -- Records that carry this account's personal data (never a money row): removed before the sessions and tokens they point at.
  DELETE FROM app.notification_pushes WHERE recipient_user_id = p_user_id;
  DELETE FROM app.notification_reminders WHERE recipient_user_id = p_user_id;
  DELETE FROM app.notifications WHERE recipient_user_id = p_user_id;
  DELETE FROM app.notification_settings WHERE user_id = p_user_id;
  DELETE FROM app.notification_push_tokens WHERE user_id = p_user_id;
  DELETE FROM app.business_push_subscriptions WHERE user_id = p_user_id;
  DELETE FROM app.customer_carts WHERE user_id = p_user_id;
  DELETE FROM app.customer_addresses WHERE customer_id IN (SELECT id FROM app.customers WHERE user_id = p_user_id);
  DELETE FROM app.customer_profiles WHERE user_id = p_user_id;

  -- Device bindings and keys: the same order and the same shared-key rules as app.purge_app_user.
  SELECT COALESCE(array_agg(key_id), ARRAY[]::uuid[]) INTO v_keys FROM app.client_device_key_links WHERE user_id = p_user_id;
  DELETE FROM app.client_session_bindings WHERE session_id IN (SELECT session_id FROM app.sessions WHERE user_id = p_user_id);
  DELETE FROM app.client_device_registration_grants WHERE join_binding_id IN (SELECT binding_id FROM app.client_device_bindings WHERE user_id = p_user_id);
  DELETE FROM app.client_device_key_links WHERE user_id = p_user_id;
  DELETE FROM app.client_device_bindings WHERE user_id = p_user_id;
  DELETE FROM app.client_device_request_nonces n
   WHERE n.key_id = ANY (v_keys) AND NOT EXISTS (SELECT 1 FROM app.client_device_key_links l WHERE l.key_id = n.key_id);
  DELETE FROM app.client_device_challenges c
   WHERE c.key_id = ANY (v_keys) AND NOT EXISTS (SELECT 1 FROM app.client_device_key_links l WHERE l.key_id = c.key_id);
  DELETE FROM app.client_device_registration_grants g
   WHERE g.key_id = ANY (v_keys) AND NOT EXISTS (SELECT 1 FROM app.client_device_key_links l WHERE l.key_id = g.key_id);
  DELETE FROM app.client_device_keys k
   WHERE k.key_id = ANY (v_keys)
     AND NOT EXISTS (SELECT 1 FROM app.client_device_key_links l WHERE l.key_id = k.key_id)
     AND NOT EXISTS (SELECT 1 FROM app.client_device_registration_grants g WHERE g.key_id = k.key_id OR g.authorizer_key_id = k.key_id);
  DELETE FROM app.sessions WHERE user_id = p_user_id;

  -- Shops of the account. A shop with no other member is anonymized (contact, address, logo, coordinates) and closed to orders; a shop
  -- with other members keeps its data and only loses this member.
  FOR v_shop IN
    SELECT m.shop_id, (SELECT count(*) FROM app.shop_members o WHERE o.shop_id = m.shop_id AND o.user_id <> p_user_id) AS others
      FROM app.shop_members m WHERE m.user_id = p_user_id
  LOOP
    IF v_shop.others = 0 THEN
      UPDATE app.shops SET name = 'Cửa hàng đã ẩn danh', contact_phone_normalized = app.anonymized_phone_number(), zalo = NULL, facebook = NULL,
             address_text = 'Đã ẩn danh', pickup_lat = NULL, pickup_lng = NULL, logo = NULL, setup_request_note = NULL, setup_request_at = NULL,
             status = 'DISABLED', accepting_orders = false, version = version + 1, updated_at = now()
       WHERE shop_id = v_shop.shop_id;
      UPDATE app.orders SET shop_name = 'Cửa hàng đã ẩn danh', shop_phone = app.anonymized_phone_number(), shop_address_text = 'Đã ẩn danh',
             version = version + 1, updated_at = now()
       WHERE shop_id = v_shop.shop_id;
      UPDATE app.deliveries SET shop_name = 'Cửa hàng đã ẩn danh', shop_phone = app.anonymized_phone_number(), pickup_address_text = 'Đã ẩn danh',
             pickup_lat = NULL, pickup_lng = NULL, version = version + 1, updated_at = now()
       WHERE shop_id = v_shop.shop_id;
    END IF;
    DELETE FROM app.shop_members WHERE shop_id = v_shop.shop_id AND user_id = p_user_id;
  END LOOP;

  -- Driver (shipper) profile: name and plate are removed and the profile accepts nothing; the bank account row is removed. The wallet, the
  -- ledger and the withdrawals stay (money).
  SELECT driver_id INTO v_driver_id FROM app.drivers WHERE user_id = p_user_id;
  IF FOUND THEN
    UPDATE app.drivers SET full_name = 'Đã ẩn danh', plate_number = NULL, accepting_deliveries = false, version = version + 1, updated_at = now()
     WHERE driver_id = v_driver_id;
    DELETE FROM app.driver_bank_accounts WHERE driver_id = v_driver_id;
  END IF;

  -- Personal snapshots of the account's orders, deliveries and change requests. Money, state and identity columns are not touched.
  UPDATE app.orders SET recipient_name = 'Đã ẩn danh', recipient_phone = app.anonymized_phone_number(), address_text = 'Đã ẩn danh',
         address_lat = NULL, address_lng = NULL, version = version + 1, updated_at = now()
   WHERE customer_user_id = p_user_id;
  UPDATE app.deliveries SET recipient_name = 'Đã ẩn danh', recipient_phone = app.anonymized_phone_number(), dropoff_address_text = 'Đã ẩn danh',
         dropoff_area_text = NULL, dropoff_lat = NULL, dropoff_lng = NULL, version = version + 1, updated_at = now()
   WHERE requested_by = p_user_id;
  UPDATE app.address_change_requests SET original_recipient_name = 'Đã ẩn danh', original_recipient_phone = app.anonymized_phone_number(),
         original_address_text = 'Đã ẩn danh', original_lat = NULL, original_lng = NULL,
         new_recipient_name = 'Đã ẩn danh', new_recipient_phone = app.anonymized_phone_number(), new_address_text = 'Đã ẩn danh',
         new_lat = NULL, new_lng = NULL, note = NULL, reject_reason = NULL, version = version + 1, updated_at = now()
   WHERE requested_by = p_user_id;

  -- The account itself: a DISABLED tombstone under the same id. The real number is released; the placeholder cannot be dialled.
  UPDATE app.users SET phone_normalized = v_phone, password_hash = p_password_hash, status = 'DISABLED', lock_reason = 'DELETE_REQUEST',
         locked_at = now(), delete_requested_at = NULL, anonymized_at = now(), version = version + 1, updated_at = now()
   WHERE user_id = p_user_id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.anonymize_app_user(uuid, text) FROM PUBLIC;


-- The two guards: one exception each (see the header). Their definitions are the ones the earlier migrations left in place.
CREATE OR REPLACE FUNCTION app.orders_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  allow_address_change boolean := COALESCE(current_setting('app.address_change_in_progress', true), '') = 'on';
  customer_edit boolean := COALESCE(current_setting('app.customer_order_edit', true), '') = 'on';
BEGIN
  -- Owner decision 2026-11-22 (account anonymization, app.anonymize_app_user): a change to personal columns ONLY is allowed on a finished row
  -- while the anonymization runs. Every other column (identity, state, money, notes), the version rule and every rule below still apply.
  IF COALESCE(current_setting('app.account_anonymize', true), '') = 'on' AND NEW.version = OLD.version + 1
     AND (to_jsonb(NEW) - ARRAY['recipient_name', 'recipient_phone', 'address_text', 'address_lat', 'address_lng', 'shop_name', 'shop_phone', 'shop_address_text', 'version', 'updated_at']) = (to_jsonb(OLD) - ARRAY['recipient_name', 'recipient_phone', 'address_text', 'address_lat', 'address_lng', 'shop_name', 'shop_phone', 'shop_address_text', 'version', 'updated_at']) THEN
    RETURN NEW;
  END IF;
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
$function$;

CREATE OR REPLACE FUNCTION app.deliveries_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  adjust boolean := COALESCE(current_setting('app.m07_admin_adjust', true), '') = 'on';
  allow_address_change boolean := COALESCE(current_setting('app.address_change_in_progress', true), '') = 'on';
BEGIN
  -- Owner decision 2026-11-22 (account anonymization, app.anonymize_app_user): a change to personal columns ONLY is allowed on a finished row
  -- while the anonymization runs. Every other column (identity, state, money, notes), the version rule and every rule below still apply.
  IF COALESCE(current_setting('app.account_anonymize', true), '') = 'on' AND NEW.version = OLD.version + 1
     AND (to_jsonb(NEW) - ARRAY['recipient_name', 'recipient_phone', 'dropoff_address_text', 'dropoff_area_text', 'dropoff_lat', 'dropoff_lng', 'pickup_address_text', 'pickup_lat', 'pickup_lng', 'shop_name', 'shop_phone', 'version', 'updated_at']) = (to_jsonb(OLD) - ARRAY['recipient_name', 'recipient_phone', 'dropoff_address_text', 'dropoff_area_text', 'dropoff_lat', 'dropoff_lng', 'pickup_address_text', 'pickup_lat', 'pickup_lng', 'shop_name', 'shop_phone', 'version', 'updated_at']) THEN
    RETURN NEW;
  END IF;
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
$function$;


-- Down Migration
-- Only for disposable test or experimental databases: an anonymized account cannot be restored (its personal data is gone by design).
-- It REFUSES while any anonymized account exists; it never deletes or rewrites an account to make itself succeed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.users WHERE anonymized_at IS NOT NULL) THEN
    RAISE EXCEPTION 'cannot roll back account anonymization: anonymized accounts exist';
  END IF;
END
$$;

-- The two guards go back to the definitions the earlier migrations left in place (no exception).
CREATE OR REPLACE FUNCTION app.orders_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION app.deliveries_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$;

DROP FUNCTION app.anonymize_app_user(uuid, text);
DROP FUNCTION app.anonymized_phone_number();
DROP SEQUENCE app.account_anonymized_phone_seq;
ALTER TABLE app.users DROP CONSTRAINT users_anonymized_ck;
ALTER TABLE app.users DROP COLUMN anonymized_at;
