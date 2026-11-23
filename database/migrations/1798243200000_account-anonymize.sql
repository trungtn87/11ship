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
--    It NEVER deletes an order, delivery, wallet, ledger, withdrawal, review, complaint text or consent row.
--  * Further personal records, all in the same transaction: the customer notes of orders, order lines and deliveries (orders.note,
--    orders.delivery_note, order_items.note, deliveries.note, deliveries.dropoff_note) become the fixed text "Đã ẩn danh"; the chat messages the
--    account sent keep their row and time but their text and sender name become fixed texts; the pictures the account uploaded for a complaint
--    (complaint_attachments, linked or not) are DELETED (the complaint text stays); the bank account number and holder of CLOSED withdrawals
--    become fixed values ('000000' / 'Đã ẩn danh') while amount, state and money trail stay (an OPEN withdrawal refuses the anonymization);
--    the SMS jobs of the phone are deleted (sms_jobs_phone_ck allows only +84 numbers, so they cannot keep a placeholder) and the verification and
--    proof rows of the phone get a placeholder number. There is no "ảnh giấy tờ" table in this schema; menu_images are dish photos and are kept.
--  * Second round: complaint text and shop / shipper names (complaints), the reviewer name (reviews), the account's own complaint messages,
--    review replies and their history, the event notes the account wrote (order_events, delivery_events), the incident notes (delivery_incidents),
--    the personal keys and the phone number inside the JSON and text of outbox_events.payload, audit_logs.metadata, ops_events, ops_notifications,
--    ops_anomaly_cases. The complaint pictures of an OPEN complaint are kept; app.purge_closed_complaint_pictures() removes them once it is
--    closed (callable again; SECURITY DEFINER; EXECUTE for the runtime role in 03-runtime-function-grants.sql).
--    Trade-off: the audit_logs table keeps its single statement trigger (the migration drift test pins it), so under the anonymization its
--    UPDATE is allowed statement-wide (not column-wide); it is the only table without a column-level check.
--  * Controlled exceptions, each active ONLY while app.anonymize_app_user runs (transaction setting app.account_anonymize = 'on', and for the
--    complaint pictures also app.account_anonymize_user = the account) and ONLY for a write that changes the listed personal columns to their
--    fixed value and nothing else: orders_guard, deliveries_guard, order_items_guard, order_chat_messages_reject_update,
--    complaint_attachments_delete_guard, wallet_withdrawals_guard and address_note_snapshot_guard. Every other write still meets every rule of
--    these guards (identity, state, money, notes, version, terminal rows) exactly as before. No trigger is disabled by this migration.


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
  v_old_phone text;
  v_phones text[];
  v_keys uuid[];
  v_shop record;
  v_driver_id uuid;
  v_anon_shops uuid[] := ARRAY[]::uuid[];
BEGIN
  PERFORM 1 FROM app.users WHERE user_id = p_user_id AND account_scope = 'APP_USER' AND anonymized_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM set_config('app.account_anonymize', 'on', true);
  -- Read by the complaint-picture delete guard: only the pictures this account uploaded may go, in this transaction.
  PERFORM set_config('app.account_anonymize_user', p_user_id::text, true);
  SELECT phone_normalized INTO v_old_phone FROM app.users WHERE user_id = p_user_id;
  -- The phone in both forms (+84… and 0…) for the text and JSON scrubs below.
  v_phones := ARRAY[v_old_phone, '0' || substring(v_old_phone FROM 4)];
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
      v_anon_shops := array_append(v_anon_shops, v_shop.shop_id);
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
  -- Notes the customer wrote (order, its delivery instruction, the delivery note) become one fixed text; an empty note stays empty.
  UPDATE app.orders SET recipient_name = 'Đã ẩn danh', recipient_phone = app.anonymized_phone_number(), address_text = 'Đã ẩn danh',
         address_lat = NULL, address_lng = NULL, note = CASE WHEN note IS NULL THEN NULL ELSE 'Đã ẩn danh' END,
         delivery_note = CASE WHEN delivery_note IS NULL THEN NULL ELSE 'Đã ẩn danh' END, version = version + 1, updated_at = now()
   WHERE customer_user_id = p_user_id;
  UPDATE app.order_items SET note = 'Đã ẩn danh'
   WHERE note IS NOT NULL AND order_id IN (SELECT order_id FROM app.orders WHERE customer_user_id = p_user_id);
  UPDATE app.deliveries SET recipient_name = 'Đã ẩn danh', recipient_phone = app.anonymized_phone_number(), dropoff_address_text = 'Đã ẩn danh',
         dropoff_area_text = NULL, dropoff_lat = NULL, dropoff_lng = NULL,
         note = CASE WHEN note IS NULL THEN NULL ELSE 'Đã ẩn danh' END, dropoff_note = CASE WHEN dropoff_note IS NULL THEN NULL ELSE 'Đã ẩn danh' END,
         version = version + 1, updated_at = now()
   WHERE requested_by = p_user_id;
  UPDATE app.address_change_requests SET original_recipient_name = 'Đã ẩn danh', original_recipient_phone = app.anonymized_phone_number(),
         original_address_text = 'Đã ẩn danh', original_lat = NULL, original_lng = NULL,
         new_recipient_name = 'Đã ẩn danh', new_recipient_phone = app.anonymized_phone_number(), new_address_text = 'Đã ẩn danh',
         new_lat = NULL, new_lng = NULL, note = NULL, reject_reason = NULL, version = version + 1, updated_at = now()
   WHERE requested_by = p_user_id;

  -- Chat messages the account sent: the text and the sender name go, the row, its order and its time stay (order_chat_messages_reject_update
  -- lets exactly this change through while the anonymization runs).
  UPDATE app.order_chat_messages SET body = 'Tin nhắn đã ẩn danh', sender_name = 'Đã ẩn danh'
   WHERE sender_user_id = p_user_id AND (body <> 'Tin nhắn đã ẩn danh' OR sender_name <> 'Đã ẩn danh');

  -- Pictures the account uploaded: an unlinked one, or one of a CLOSED complaint, is deleted. A picture of an OPEN complaint is kept; the cleanup
  -- app.purge_closed_complaint_pictures() removes it once that complaint is closed (complaint_attachments_delete_guard lets exactly these through).
  DELETE FROM app.complaint_attachments
   WHERE uploader_user_id = p_user_id
     AND (complaint_id IS NULL OR complaint_id IN (SELECT complaint_id FROM app.complaints WHERE status IN ('RESOLVED', 'CLOSED_NO_ACTION')));

  -- Bank account numbers kept in withdrawals: a withdrawal that is still open would keep the real number, so the account is refused first.
  -- A closed one (paid or cancelled) keeps its amount, state and money trail; only the destination number and holder are replaced.
  IF EXISTS (
    SELECT 1 FROM app.wallet_withdrawals w JOIN app.drivers d ON d.driver_id = w.driver_id
     WHERE d.user_id = p_user_id AND w.state NOT IN ('PAID', 'CANCELLED')
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_ANONYMIZE_OPEN_WITHDRAWAL' USING ERRCODE = 'restrict_violation';
  END IF;
  UPDATE app.wallet_withdrawals w SET account_number = '000000', account_holder = 'Đã ẩn danh', version = w.version + 1
    FROM app.drivers d
   WHERE d.driver_id = w.driver_id AND d.user_id = p_user_id AND (w.account_number <> '000000' OR w.account_holder <> 'Đã ẩn danh');

  -- OTP records of the phone. An SMS job cannot carry a placeholder number (sms_jobs_phone_ck: +84 only), so the account's queued or sent
  -- jobs are deleted with their encrypted payloads. The verification and proof rows keep their history under a placeholder number.
  DELETE FROM app.sms_jobs WHERE phone_normalized = v_old_phone AND verification_id IS NOT NULL;
  UPDATE app.verification_proofs SET phone_normalized = app.anonymized_phone_number() WHERE phone_normalized = v_old_phone;
  UPDATE app.phone_verifications SET phone_normalized = app.anonymized_phone_number() WHERE phone_normalized = v_old_phone;

  -- Second round (Owner 2026-11-22): the names and texts of complaints, reviews, events, incidents, the outbox, the audit trail and operations.
  -- Every row keeps its id, state, time and money; only the personal text, name or number becomes the fixed value.
  UPDATE app.complaints SET body = 'Đã ẩn danh', version = version + 1, updated_at = now()
   WHERE submitter_user_id = p_user_id AND body <> 'Đã ẩn danh';
  IF v_driver_id IS NOT NULL THEN
    UPDATE app.complaints SET driver_name = 'Đã ẩn danh', version = version + 1, updated_at = now()
     WHERE driver_id = v_driver_id AND driver_name IS DISTINCT FROM 'Đã ẩn danh';
  END IF;
  UPDATE app.complaints SET shop_name = 'Cửa hàng đã ẩn danh', version = version + 1, updated_at = now()
   WHERE shop_id = ANY (v_anon_shops) AND shop_name <> 'Cửa hàng đã ẩn danh';
  UPDATE app.complaint_messages SET body = 'Đã ẩn danh'
   WHERE author_user_id = p_user_id AND body IS NOT NULL AND body <> 'Đã ẩn danh';
  UPDATE app.reviews SET reviewer_name = 'Đã ẩn danh', version = version + 1
   WHERE reviewer_user_id = p_user_id AND reviewer_name <> 'Đã ẩn danh';
  UPDATE app.review_replies SET body = 'Đã ẩn danh', version = version + 1, updated_at = now()
   WHERE body <> 'Đã ẩn danh' AND review_id IN (SELECT review_id FROM app.reviews WHERE reviewer_user_id = p_user_id);
  UPDATE app.review_reply_history SET body = 'Đã ẩn danh'
   WHERE body <> 'Đã ẩn danh' AND review_id IN (SELECT review_id FROM app.reviews WHERE reviewer_user_id = p_user_id);
  -- Event notes the account itself wrote (the system's and the shop's notes stay).
  UPDATE app.order_events SET note = 'Đã ẩn danh' WHERE actor_id = p_user_id AND note IS NOT NULL AND note <> 'Đã ẩn danh';
  UPDATE app.delivery_events SET note = 'Đã ẩn danh' WHERE actor_id = p_user_id AND note IS NOT NULL AND note <> 'Đã ẩn danh';
  -- Incident notes of the anonymized shipper, and the notes of incidents this account closed.
  UPDATE app.delivery_incidents
     SET reason_note = CASE WHEN reason_note IS NULL THEN NULL ELSE 'Đã ẩn danh' END,
         close_note = CASE WHEN close_note IS NULL THEN NULL ELSE 'Đã ẩn danh' END,
         version = version + 1, updated_at = now()
   WHERE (driver_id = v_driver_id OR closed_by = p_user_id)
     AND (reason_note IS DISTINCT FROM 'Đã ẩn danh' AND reason_note IS NOT NULL OR close_note IS DISTINCT FROM 'Đã ẩn danh' AND close_note IS NOT NULL);
  -- JSON and text of the outbox, the audit trail and operations: the personal keys and the phone number of the account are replaced; the
  -- structure, the ids and the actions stay. The rows are those that name the account (its id, its phone, or its orders / deliveries).
  UPDATE app.outbox_events SET payload = app.anonymize_json(payload, v_phones)
   WHERE payload::text LIKE ANY (ARRAY['%' || p_user_id::text || '%', '%' || v_phones[1] || '%', '%' || v_phones[2] || '%'])
      OR resource_id = p_user_id::text
      OR resource_id IN (SELECT order_id::text FROM app.orders WHERE customer_user_id = p_user_id)
      OR resource_id IN (SELECT delivery_id::text FROM app.deliveries WHERE requested_by = p_user_id);
  UPDATE app.audit_logs SET metadata = app.anonymize_json(metadata, v_phones)
   WHERE metadata::text LIKE ANY (ARRAY['%' || v_phones[1] || '%', '%' || v_phones[2] || '%'])
      OR actor_id = p_user_id::text OR resource_id = p_user_id::text;
  UPDATE app.ops_events
     SET message = replace(replace(message, v_phones[1], 'Đã ẩn danh'), v_phones[2], 'Đã ẩn danh'),
         detail = app.anonymize_json(detail, v_phones)
   WHERE message LIKE ANY (ARRAY['%' || v_phones[1] || '%', '%' || v_phones[2] || '%'])
      OR detail::text LIKE ANY (ARRAY['%' || v_phones[1] || '%', '%' || v_phones[2] || '%', '%' || p_user_id::text || '%']);
  UPDATE app.ops_notifications SET content = app.anonymize_json(content, v_phones)
   WHERE content::text LIKE ANY (ARRAY['%' || v_phones[1] || '%', '%' || v_phones[2] || '%', '%' || p_user_id::text || '%']);
  UPDATE app.ops_anomaly_cases
     SET evidence = app.anonymize_json(evidence, v_phones),
         note = replace(replace(note, v_phones[1], 'Đã ẩn danh'), v_phones[2], 'Đã ẩn danh')
   WHERE (subject_kind = 'USER' AND subject_id = p_user_id)
      OR evidence::text LIKE ANY (ARRAY['%' || v_phones[1] || '%', '%' || v_phones[2] || '%'])
      OR note LIKE ANY (ARRAY['%' || v_phones[1] || '%', '%' || v_phones[2] || '%']);

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
     AND (to_jsonb(NEW) - ARRAY['recipient_name', 'recipient_phone', 'address_text', 'address_lat', 'address_lng', 'shop_name', 'shop_phone', 'shop_address_text', 'note', 'delivery_note', 'version', 'updated_at']) = (to_jsonb(OLD) - ARRAY['recipient_name', 'recipient_phone', 'address_text', 'address_lat', 'address_lng', 'shop_name', 'shop_phone', 'shop_address_text', 'note', 'delivery_note', 'version', 'updated_at']) THEN
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
     AND (to_jsonb(NEW) - ARRAY['recipient_name', 'recipient_phone', 'dropoff_address_text', 'dropoff_area_text', 'dropoff_lat', 'dropoff_lng', 'pickup_address_text', 'pickup_lat', 'pickup_lng', 'shop_name', 'shop_phone', 'note', 'dropoff_note', 'version', 'updated_at']) = (to_jsonb(OLD) - ARRAY['recipient_name', 'recipient_phone', 'dropoff_address_text', 'dropoff_area_text', 'dropoff_lat', 'dropoff_lng', 'pickup_address_text', 'pickup_lat', 'pickup_lng', 'shop_name', 'shop_phone', 'note', 'dropoff_note', 'version', 'updated_at']) THEN
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


-- The four other guards that refuse a change to a personal record. Each keeps its full earlier rule and adds ONE exception, active only while
-- app.anonymize_app_user runs and only for the fixed anonymized value and nothing else.
CREATE OR REPLACE FUNCTION app.order_items_guard() RETURNS trigger
  LANGUAGE plpgsql AS $function$
DECLARE
  parent_status varchar;
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'app.order_items is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  -- Owner decision 2026-11-22 (account anonymization): the line note becomes the fixed text; nothing else on the line changes.
  IF TG_OP = 'UPDATE' AND COALESCE(current_setting('app.account_anonymize', true), '') = 'on' AND NEW.note = 'Đã ẩn danh'
     AND (to_jsonb(NEW) - ARRAY['note']) = (to_jsonb(OLD) - ARRAY['note']) THEN
    RETURN NEW;
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
$function$;

CREATE OR REPLACE FUNCTION app.order_chat_messages_reject_update() RETURNS trigger
  LANGUAGE plpgsql AS $function$
BEGIN
  -- Owner decision 2026-11-22 (account anonymization): only the text and the sender name of a message become the fixed values.
  IF COALESCE(current_setting('app.account_anonymize', true), '') = 'on' AND NEW.body = 'Tin nhắn đã ẩn danh' AND NEW.sender_name = 'Đã ẩn danh'
     AND (to_jsonb(NEW) - ARRAY['body', 'sender_name']) = (to_jsonb(OLD) - ARRAY['body', 'sender_name']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'app.order_chat_messages rows are never updated' USING ERRCODE = 'restrict_violation';
END
$function$;

CREATE OR REPLACE FUNCTION app.complaint_attachments_delete_guard() RETURNS trigger
  LANGUAGE plpgsql AS $function$
BEGIN
  -- Owner decision 2026-11-22 (account anonymization): the pictures this account uploaded, linked or not, are deleted in that transaction.
  IF COALESCE(current_setting('app.account_anonymize', true), '') = 'on'
     AND OLD.uploader_user_id::text = COALESCE(current_setting('app.account_anonymize_user', true), '') THEN
    RETURN OLD;
  END IF;
  IF OLD.complaint_id IS NOT NULL OR OLD.created_at > clock_timestamp() - interval '24 hours' THEN
    RAISE EXCEPTION 'app.complaint_attachments: only an unlinked picture older than 24 hours may be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION app.wallet_withdrawals_guard() RETURNS trigger
  LANGUAGE plpgsql AS $function$
BEGIN
  PERFORM 1 FROM app.driver_wallets WHERE wallet_id = NEW.wallet_id FOR UPDATE;
  -- Owner decision 2026-11-22 (account anonymization): a CLOSED withdrawal keeps its amount, state and money trail; only the destination number
  -- and holder become the fixed values (version +1). Nothing else changes.
  IF TG_OP = 'UPDATE' AND COALESCE(current_setting('app.account_anonymize', true), '') = 'on' AND OLD.state IN ('PAID', 'CANCELLED')
     AND NEW.state = OLD.state AND NEW.account_number = '000000' AND NEW.account_holder = 'Đã ẩn danh' AND NEW.version = OLD.version + 1
     AND (to_jsonb(NEW) - ARRAY['account_number', 'account_holder', 'version']) = (to_jsonb(OLD) - ARRAY['account_number', 'account_holder', 'version']) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'PENDING' OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'WALLET_WITHDRAWAL_MUST_START_PENDING' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.withdrawal_id <> OLD.withdrawal_id OR NEW.wallet_id <> OLD.wallet_id OR NEW.driver_id <> OLD.driver_id OR NEW.hold_id <> OLD.hold_id
     OR NEW.amount_vnd <> OLD.amount_vnd OR NEW.created_by_user_id <> OLD.created_by_user_id OR NEW.created_at <> OLD.created_at
     OR NEW.bank_code <> OLD.bank_code OR NEW.bank_name <> OLD.bank_name OR NEW.account_number <> OLD.account_number OR NEW.account_holder <> OLD.account_holder
     OR NEW.bank_snapshot_at <> OLD.bank_snapshot_at OR NEW.bank_verified_at <> OLD.bank_verified_at THEN
    RAISE EXCEPTION 'WALLET_WITHDRAWAL_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  -- Written once, never rewritten: the claim, the reconciliation report, the outgoing record and the resolution.
  IF (OLD.processing_owner_user_id IS NOT NULL AND (NEW.processing_owner_user_id IS DISTINCT FROM OLD.processing_owner_user_id OR NEW.processing_attempt_id IS DISTINCT FROM OLD.processing_attempt_id OR NEW.processing_started_at IS DISTINCT FROM OLD.processing_started_at))
     OR (OLD.reconciliation_reason IS NOT NULL AND (NEW.reconciliation_reason IS DISTINCT FROM OLD.reconciliation_reason OR NEW.reconciliation_reported_by_user_id IS DISTINCT FROM OLD.reconciliation_reported_by_user_id OR NEW.reconciliation_reported_at IS DISTINCT FROM OLD.reconciliation_reported_at))
     OR (OLD.bank_record_id IS NOT NULL AND NEW.bank_record_id IS DISTINCT FROM OLD.bank_record_id) THEN
    RAISE EXCEPTION 'WALLET_WITHDRAWAL_EVIDENCE_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT ((OLD.state = 'PENDING' AND NEW.state IN ('PROCESSING', 'CANCELLED'))
       OR (OLD.state = 'PROCESSING' AND NEW.state IN ('PAID', 'RECONCILIATION'))
       OR (OLD.state = 'RECONCILIATION' AND NEW.state IN ('RECONCILIATION', 'PAID', 'CANCELLED'))) THEN
    RAISE EXCEPTION 'WALLET_WITHDRAWAL_TRANSITION_REFUSED: % -> %', OLD.state, NEW.state USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'WALLET_WITHDRAWAL_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$function$;


-- The drop-off note snapshots (orders.delivery_note, deliveries.dropoff_note) are immutable except inside the customer's edit; the anonymization
-- may replace them by the fixed text only (same switch as the other exceptions above).
CREATE OR REPLACE FUNCTION app.address_note_snapshot_guard() RETURNS trigger
  LANGUAGE plpgsql AS $function$
BEGIN
  IF TG_TABLE_NAME = 'orders' AND to_jsonb(NEW)->'delivery_note' IS DISTINCT FROM to_jsonb(OLD)->'delivery_note'
     AND COALESCE(current_setting('app.customer_order_edit', true), '') <> 'on'
     AND NOT (COALESCE(current_setting('app.account_anonymize', true), '') = 'on' AND to_jsonb(NEW)->>'delivery_note' = 'Đã ẩn danh') THEN
    RAISE EXCEPTION 'ORDER_DELIVERY_NOTE_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_TABLE_NAME = 'deliveries' AND to_jsonb(NEW)->'dropoff_note' IS DISTINCT FROM to_jsonb(OLD)->'dropoff_note'
     AND NOT (COALESCE(current_setting('app.account_anonymize', true), '') = 'on' AND to_jsonb(NEW)->>'dropoff_note' = 'Đã ẩn danh') THEN
    RAISE EXCEPTION 'DELIVERY_DROPOFF_NOTE_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$function$;


-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Second round (Owner 2026-11-22). The helpers below are used by the guards and by app.anonymize_app_user only.
-- A personal value becomes 'Đã ẩn danh' (a shop name 'Cửa hàng đã ẩn danh'); ids, states, times and money are never touched.

CREATE FUNCTION app.anon_pii_keys() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['phone', 'phone_normalized', 'recipient_phone', 'shop_phone', 'contact_phone', 'phone_number', 'name', 'full_name', 'recipient_name',
    'driver_name', 'shop_name', 'reviewer_name', 'address', 'address_text', 'address_description', 'pickup_address_text', 'dropoff_address_text',
    'dropoff_area_text', 'note', 'reason_note', 'close_note', 'body', 'account_number', 'account_holder', 'sender_name', 'delivery_note', 'dropoff_note']::text[]
$$;

-- The fixed values a personal text column may hold after the anonymization.
CREATE FUNCTION app.anon_value_ok(v text) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$
  SELECT v IS NULL OR v IN ('Đã ẩn danh', 'Cửa hàng đã ẩn danh', 'Tin nhắn đã ẩn danh')
$$;

-- True only while app.anonymize_app_user runs AND the write changes the listed fields and nothing else.
CREATE FUNCTION app.anon_only(old_row jsonb, new_row jsonb, fields text[]) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.account_anonymize', true), '') = 'on' AND (new_row - fields) = (old_row - fields)
$$;

-- Replaces the personal keys (any depth) and the phone numbers inside text values; every other key, value, array and id is kept.
CREATE FUNCTION app.anonymize_json(doc jsonb, phones text[]) RETURNS jsonb
  LANGUAGE plpgsql AS $$
DECLARE
  k text;
  v jsonb;
  elem jsonb;
  acc jsonb := '{}'::jsonb;
  arr jsonb := '[]'::jsonb;
  txt text;
  p text;
BEGIN
  IF jsonb_typeof(doc) = 'object' THEN
    FOR k, v IN SELECT key, value FROM jsonb_each(doc) LOOP
      IF k = ANY (app.anon_pii_keys()) AND jsonb_typeof(v) IN ('string', 'number') THEN
        acc := acc || jsonb_build_object(k, 'Đã ẩn danh');
      ELSE
        acc := acc || jsonb_build_object(k, app.anonymize_json(v, phones));
      END IF;
    END LOOP;
    RETURN acc;
  ELSIF jsonb_typeof(doc) = 'array' THEN
    FOR elem IN SELECT value FROM jsonb_array_elements(doc) LOOP
      arr := arr || jsonb_build_array(app.anonymize_json(elem, phones));
    END LOOP;
    RETURN arr;
  ELSIF jsonb_typeof(doc) = 'string' THEN
    txt := doc #>> '{}';
    IF phones IS NOT NULL THEN
      FOREACH p IN ARRAY phones LOOP
        IF p IS NOT NULL AND p <> '' THEN
          txt := replace(txt, p, 'Đã ẩn danh');
        END IF;
      END LOOP;
    END IF;
    RETURN to_jsonb(txt);
  END IF;
  RETURN doc;
END
$$;

-- Row guards for the append-only tables whose personal text is replaced (the statement trigger keeps DELETE / TRUNCATE).
-- The field is the trigger argument; the new value must be a fixed value or unchanged.
CREATE FUNCTION app.anon_row_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  field text := TG_ARGV[0];
BEGIN
  IF app.anon_only(to_jsonb(OLD), to_jsonb(NEW), ARRAY[field])
     AND (to_jsonb(NEW) ->> field = to_jsonb(OLD) ->> field OR app.anon_value_ok(to_jsonb(NEW) ->> field)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'app.% is append-only (UPDATE rejected)', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END
$$;


-- Complaints: the text, the shipper's name and the shop's name may take their fixed values; nothing else moves (the state rules below stay).
CREATE OR REPLACE FUNCTION app.complaints_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Owner decision 2026-11-22 (account anonymization): only the personal text / names change, the version +1; nothing else.
  IF TG_OP = 'UPDATE' AND app.anon_only(to_jsonb(OLD), to_jsonb(NEW), ARRAY['body', 'shop_name', 'driver_name', 'version', 'updated_at'])
     AND NEW.version = OLD.version + 1
     AND (NEW.body = OLD.body OR app.anon_value_ok(NEW.body))
     AND (NEW.shop_name = OLD.shop_name OR app.anon_value_ok(NEW.shop_name))
     AND (NEW.driver_name IS NOT DISTINCT FROM OLD.driver_name OR app.anon_value_ok(NEW.driver_name)) THEN
    RETURN NEW;
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.complaints is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.complaint_id <> OLD.complaint_id OR NEW.code <> OLD.code OR NEW.submitter_user_id <> OLD.submitter_user_id OR NEW.submitter_role <> OLD.submitter_role
     OR NEW.category <> OLD.category OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.delivery_id IS DISTINCT FROM OLD.delivery_id
     OR NEW.review_id IS DISTINCT FROM OLD.review_id OR NEW.shop_id IS DISTINCT FROM OLD.shop_id OR NEW.driver_id IS DISTINCT FROM OLD.driver_id
     OR NEW.scope_key <> OLD.scope_key OR NEW.body <> OLD.body OR NEW.related_code <> OLD.related_code OR NEW.shop_name <> OLD.shop_name
     OR NEW.driver_name IS DISTINCT FROM OLD.driver_name OR NEW.driver_code IS DISTINCT FROM OLD.driver_code OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'COMPLAINT_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'COMPLAINT_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PENDING' AND NEW.status IN ('IN_PROGRESS', 'CLOSED_NO_ACTION'))
    OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('AWAITING_INFO', 'RESOLVED', 'CLOSED_NO_ACTION'))
    OR (OLD.status = 'AWAITING_INFO' AND NEW.status IN ('IN_PROGRESS', 'RESOLVED', 'CLOSED_NO_ACTION'))
    OR (OLD.status IN ('RESOLVED', 'CLOSED_NO_ACTION') AND NEW.status = 'IN_PROGRESS')
  ) THEN
    RAISE EXCEPTION 'COMPLAINT_STATE_TRANSITION: % -> %', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  -- Every entry into a closed state counts one closure; nothing else moves the counter.
  IF (NEW.status IN ('RESOLVED', 'CLOSED_NO_ACTION')) AND (OLD.status NOT IN ('RESOLVED', 'CLOSED_NO_ACTION')) AND NEW.closure_no <> OLD.closure_no + 1 THEN
    RAISE EXCEPTION 'COMPLAINT_CLOSURE_COUNT' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT (NEW.status IN ('RESOLVED', 'CLOSED_NO_ACTION') AND OLD.status NOT IN ('RESOLVED', 'CLOSED_NO_ACTION')) AND NEW.closure_no <> OLD.closure_no THEN
    RAISE EXCEPTION 'COMPLAINT_CLOSURE_COUNT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- Reviews: the reviewer's name may take its fixed value (the review text and the stars stay).
CREATE OR REPLACE FUNCTION app.reviews_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND app.anon_only(to_jsonb(OLD), to_jsonb(NEW), ARRAY['reviewer_name', 'version'])
     AND NEW.version = OLD.version + 1 AND (NEW.reviewer_name = OLD.reviewer_name OR app.anon_value_ok(NEW.reviewer_name)) THEN
    RETURN NEW;
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.reviews is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.review_id <> OLD.review_id OR NEW.kind <> OLD.kind OR NEW.reviewer_user_id <> OLD.reviewer_user_id OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
     OR NEW.driver_id IS DISTINCT FROM OLD.driver_id OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.delivery_id IS DISTINCT FROM OLD.delivery_id
     OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id OR NEW.stars <> OLD.stars OR NEW.comment IS DISTINCT FROM OLD.comment
     OR NEW.reviewer_name <> OLD.reviewer_name OR NEW.shop_name <> OLD.shop_name OR NEW.driver_name IS DISTINCT FROM OLD.driver_name
     OR NEW.related_code <> OLD.related_code OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'REVIEW_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'REVIEW_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- The append-only tables. A statement guard refuses UPDATE as before, EXCEPT while app.anonymize_app_user runs (then the row guard below decides,
-- column by column). A zero-row UPDATE is still refused without the anonymization, as before. DELETE and TRUNCATE keep their refusal.
CREATE FUNCTION app.append_only_except_anonymize() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(current_setting('app.account_anonymize', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END
$$;

DROP TRIGGER complaint_messages_append_only ON app.complaint_messages;
CREATE TRIGGER complaint_messages_append_only BEFORE DELETE OR UPDATE OR TRUNCATE ON app.complaint_messages FOR EACH STATEMENT EXECUTE FUNCTION app.append_only_except_anonymize();
CREATE TRIGGER complaint_messages_anonymize BEFORE UPDATE ON app.complaint_messages FOR EACH ROW EXECUTE FUNCTION app.anon_row_guard('body');

DROP TRIGGER review_reply_history_append_only ON app.review_reply_history;
CREATE TRIGGER review_reply_history_append_only BEFORE DELETE OR UPDATE OR TRUNCATE ON app.review_reply_history FOR EACH STATEMENT EXECUTE FUNCTION app.append_only_except_anonymize();
CREATE TRIGGER review_reply_history_anonymize BEFORE UPDATE ON app.review_reply_history FOR EACH ROW EXECUTE FUNCTION app.anon_row_guard('body');

CREATE OR REPLACE FUNCTION app.order_events_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(current_setting('app.account_anonymize', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'app.order_events is append-only (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER order_events_anonymize BEFORE UPDATE ON app.order_events FOR EACH ROW EXECUTE FUNCTION app.anon_row_guard('note');

CREATE OR REPLACE FUNCTION app.delivery_events_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(current_setting('app.account_anonymize', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'app.delivery_events is append-only (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER delivery_events_anonymize BEFORE UPDATE ON app.delivery_events FOR EACH ROW EXECUTE FUNCTION app.anon_row_guard('note');

-- The audit trail keeps its ONE statement trigger (the migration drift test pins it). Under the anonymization only the scrub of metadata is
-- allowed by this statement guard; the audit rows keep their actor, action, resource and time. See the report for this trade-off.
CREATE OR REPLACE FUNCTION app.audit_logs_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(current_setting('app.account_anonymize', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'app.audit_logs is append-only (% rejected)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- The operations events: the append-only rule keeps every column except the message and the detail, which the scrub may replace.
CREATE OR REPLACE FUNCTION app.ops_events_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND app.anon_only(to_jsonb(OLD), to_jsonb(NEW), ARRAY['message', 'detail']) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'app.ops_events is append-only (UPDATE rejected)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' AND COALESCE(current_setting('app.ops_purge', true), '') <> 'on' THEN
    RAISE EXCEPTION 'app.ops_events rows are removed only by the retention pass (DELETE rejected)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

-- Pictures: an unlinked one, or one of the account's own anonymization of a closed complaint (see anonymize_app_user), or a picture of a closed
-- complaint removed by app.purge_closed_complaint_pictures(). A picture of an open complaint is never removed.
CREATE OR REPLACE FUNCTION app.complaint_attachments_delete_guard() RETURNS trigger
  LANGUAGE plpgsql AS $function$
DECLARE
  closed boolean;
BEGIN
  closed := OLD.complaint_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM app.complaints c WHERE c.complaint_id = OLD.complaint_id AND c.status IN ('RESOLVED', 'CLOSED_NO_ACTION'));
  IF COALESCE(current_setting('app.account_anonymize', true), '') = 'on'
     AND OLD.uploader_user_id::text = COALESCE(current_setting('app.account_anonymize_user', true), '')
     AND (OLD.complaint_id IS NULL OR closed) THEN
    RETURN OLD;
  END IF;
  IF COALESCE(current_setting('app.complaint_picture_cleanup', true), '') = 'on' AND closed THEN
    RETURN OLD;
  END IF;
  IF OLD.complaint_id IS NOT NULL OR OLD.created_at > clock_timestamp() - interval '24 hours' THEN
    RAISE EXCEPTION 'app.complaint_attachments: only an unlinked picture older than 24 hours may be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$function$;

-- The cleanup step: removes the pictures of every closed complaint. Callable again at any time; it changes nothing else.
CREATE FUNCTION app.purge_closed_complaint_pictures() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  removed integer;
BEGIN
  PERFORM set_config('app.complaint_picture_cleanup', 'on', true);
  DELETE FROM app.complaint_attachments a USING app.complaints c
   WHERE c.complaint_id = a.complaint_id AND c.status IN ('RESOLVED', 'CLOSED_NO_ACTION');
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$$;
REVOKE ALL ON FUNCTION app.purge_closed_complaint_pictures() FROM PUBLIC;


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

-- The four guards go back to their definitions before this migration (no exception).
CREATE OR REPLACE FUNCTION app.order_items_guard() RETURNS trigger
  LANGUAGE plpgsql AS $function$
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
  IF OLD.superseded_at IS NOT NULL OR (NEW.superseded_at IS NOT NULL AND (NEW.quantity <> OLD.quantity OR NEW.unit_price_vnd <> OLD.unit_price_vnd OR NEW.removed_at IS DISTINCT FROM OLD.removed_at)) THEN
    RAISE EXCEPTION 'ORDER_ITEMS_LOCKED' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.removed_at IS NOT NULL AND (NEW.removed_at IS DISTINCT FROM OLD.removed_at OR NEW.quantity <> OLD.quantity OR NEW.unit_price_vnd <> OLD.unit_price_vnd) THEN
    RAISE EXCEPTION 'ORDER_ITEMS_LOCKED' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION app.order_chat_messages_reject_update() RETURNS trigger
  LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'app.order_chat_messages rows are never updated' USING ERRCODE = 'restrict_violation';
END
$function$;

CREATE OR REPLACE FUNCTION app.complaint_attachments_delete_guard() RETURNS trigger
  LANGUAGE plpgsql AS $function$
BEGIN
  IF OLD.complaint_id IS NOT NULL OR OLD.created_at > clock_timestamp() - interval '24 hours' THEN
    RAISE EXCEPTION 'app.complaint_attachments: only an unlinked picture older than 24 hours may be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION app.wallet_withdrawals_guard() RETURNS trigger
  LANGUAGE plpgsql AS $function$
BEGIN
  PERFORM 1 FROM app.driver_wallets WHERE wallet_id = NEW.wallet_id FOR UPDATE;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'PENDING' OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'WALLET_WITHDRAWAL_MUST_START_PENDING' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.withdrawal_id <> OLD.withdrawal_id OR NEW.wallet_id <> OLD.wallet_id OR NEW.driver_id <> OLD.driver_id OR NEW.hold_id <> OLD.hold_id
     OR NEW.amount_vnd <> OLD.amount_vnd OR NEW.created_by_user_id <> OLD.created_by_user_id OR NEW.created_at <> OLD.created_at
     OR NEW.bank_code <> OLD.bank_code OR NEW.bank_name <> OLD.bank_name OR NEW.account_number <> OLD.account_number OR NEW.account_holder <> OLD.account_holder
     OR NEW.bank_snapshot_at <> OLD.bank_snapshot_at OR NEW.bank_verified_at <> OLD.bank_verified_at THEN
    RAISE EXCEPTION 'WALLET_WITHDRAWAL_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (OLD.processing_owner_user_id IS NOT NULL AND (NEW.processing_owner_user_id IS DISTINCT FROM OLD.processing_owner_user_id OR NEW.processing_attempt_id IS DISTINCT FROM OLD.processing_attempt_id OR NEW.processing_started_at IS DISTINCT FROM OLD.processing_started_at))
     OR (OLD.reconciliation_reason IS NOT NULL AND (NEW.reconciliation_reason IS DISTINCT FROM OLD.reconciliation_reason OR NEW.reconciliation_reported_by_user_id IS DISTINCT FROM OLD.reconciliation_reported_by_user_id OR NEW.reconciliation_reported_at IS DISTINCT FROM OLD.reconciliation_reported_at))
     OR (OLD.bank_record_id IS NOT NULL AND NEW.bank_record_id IS DISTINCT FROM OLD.bank_record_id) THEN
    RAISE EXCEPTION 'WALLET_WITHDRAWAL_EVIDENCE_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT ((OLD.state = 'PENDING' AND NEW.state IN ('PROCESSING', 'CANCELLED'))
       OR (OLD.state = 'PROCESSING' AND NEW.state IN ('PAID', 'RECONCILIATION'))
       OR (OLD.state = 'RECONCILIATION' AND NEW.state IN ('RECONCILIATION', 'PAID', 'CANCELLED'))) THEN
    RAISE EXCEPTION 'WALLET_WITHDRAWAL_TRANSITION_REFUSED: % -> %', OLD.state, NEW.state USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'WALLET_WITHDRAWAL_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION app.address_note_snapshot_guard() RETURNS trigger
  LANGUAGE plpgsql AS $function$
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
$function$;

-- The second round goes back too: the row triggers are removed, and the append-only functions return to their earlier definitions.
DROP TRIGGER complaint_messages_anonymize ON app.complaint_messages;
DROP TRIGGER review_reply_history_anonymize ON app.review_reply_history;
DROP TRIGGER order_events_anonymize ON app.order_events;
DROP TRIGGER delivery_events_anonymize ON app.delivery_events;
DROP TRIGGER complaint_messages_append_only ON app.complaint_messages;
CREATE TRIGGER complaint_messages_append_only BEFORE DELETE OR UPDATE OR TRUNCATE ON app.complaint_messages FOR EACH STATEMENT EXECUTE FUNCTION app.m11_append_only();
DROP TRIGGER review_reply_history_append_only ON app.review_reply_history;
CREATE TRIGGER review_reply_history_append_only BEFORE DELETE OR UPDATE OR TRUNCATE ON app.review_reply_history FOR EACH STATEMENT EXECUTE FUNCTION app.m11_append_only();
CREATE OR REPLACE FUNCTION app.order_events_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.order_events is append-only (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE OR REPLACE FUNCTION app.delivery_events_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.delivery_events is append-only (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE OR REPLACE FUNCTION app.audit_logs_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.audit_logs is append-only (% rejected)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
DROP FUNCTION app.append_only_except_anonymize();

CREATE OR REPLACE FUNCTION app.ops_events_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'app.ops_events is append-only (UPDATE rejected)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' AND COALESCE(current_setting('app.ops_purge', true), '') <> 'on' THEN
    RAISE EXCEPTION 'app.ops_events rows are removed only by the retention pass (DELETE rejected)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION app.complaint_attachments_delete_guard() RETURNS trigger
  LANGUAGE plpgsql AS $function$
BEGIN
  IF OLD.complaint_id IS NOT NULL OR OLD.created_at > clock_timestamp() - interval '24 hours' THEN
    RAISE EXCEPTION 'app.complaint_attachments: only an unlinked picture older than 24 hours may be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION app.reviews_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.reviews is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.review_id <> OLD.review_id OR NEW.kind <> OLD.kind OR NEW.reviewer_user_id <> OLD.reviewer_user_id OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
     OR NEW.driver_id IS DISTINCT FROM OLD.driver_id OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.delivery_id IS DISTINCT FROM OLD.delivery_id
     OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id OR NEW.stars <> OLD.stars OR NEW.comment IS DISTINCT FROM OLD.comment
     OR NEW.reviewer_name <> OLD.reviewer_name OR NEW.shop_name <> OLD.shop_name OR NEW.driver_name IS DISTINCT FROM OLD.driver_name
     OR NEW.related_code <> OLD.related_code OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'REVIEW_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'REVIEW_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION app.complaints_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.complaints is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.complaint_id <> OLD.complaint_id OR NEW.code <> OLD.code OR NEW.submitter_user_id <> OLD.submitter_user_id OR NEW.submitter_role <> OLD.submitter_role
     OR NEW.category <> OLD.category OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.delivery_id IS DISTINCT FROM OLD.delivery_id
     OR NEW.review_id IS DISTINCT FROM OLD.review_id OR NEW.shop_id IS DISTINCT FROM OLD.shop_id OR NEW.driver_id IS DISTINCT FROM OLD.driver_id
     OR NEW.scope_key <> OLD.scope_key OR NEW.body <> OLD.body OR NEW.related_code <> OLD.related_code OR NEW.shop_name <> OLD.shop_name
     OR NEW.driver_name IS DISTINCT FROM OLD.driver_name OR NEW.driver_code IS DISTINCT FROM OLD.driver_code OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'COMPLAINT_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'COMPLAINT_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PENDING' AND NEW.status IN ('IN_PROGRESS', 'CLOSED_NO_ACTION'))
    OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('AWAITING_INFO', 'RESOLVED', 'CLOSED_NO_ACTION'))
    OR (OLD.status = 'AWAITING_INFO' AND NEW.status IN ('IN_PROGRESS', 'RESOLVED', 'CLOSED_NO_ACTION'))
    OR (OLD.status IN ('RESOLVED', 'CLOSED_NO_ACTION') AND NEW.status = 'IN_PROGRESS')
  ) THEN
    RAISE EXCEPTION 'COMPLAINT_STATE_TRANSITION: % -> %', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.status IN ('RESOLVED', 'CLOSED_NO_ACTION')) AND (OLD.status NOT IN ('RESOLVED', 'CLOSED_NO_ACTION')) AND NEW.closure_no <> OLD.closure_no + 1 THEN
    RAISE EXCEPTION 'COMPLAINT_CLOSURE_COUNT' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT (NEW.status IN ('RESOLVED', 'CLOSED_NO_ACTION') AND OLD.status NOT IN ('RESOLVED', 'CLOSED_NO_ACTION')) AND NEW.closure_no <> OLD.closure_no THEN
    RAISE EXCEPTION 'COMPLAINT_CLOSURE_COUNT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$function$;

DROP FUNCTION app.purge_closed_complaint_pictures();
DROP FUNCTION app.anon_row_guard();
DROP FUNCTION app.anonymize_json(jsonb, text[]);
DROP FUNCTION app.anon_only(jsonb, jsonb, text[]);
DROP FUNCTION app.anon_value_ok(text);
DROP FUNCTION app.anon_pii_keys();

DROP FUNCTION app.anonymize_app_user(uuid, text);
DROP FUNCTION app.anonymized_phone_number();
DROP SEQUENCE app.account_anonymized_phone_seq;
ALTER TABLE app.users DROP CONSTRAINT users_anonymized_ck;
ALTER TABLE app.users DROP COLUMN anonymized_at;
