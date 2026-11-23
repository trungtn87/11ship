-- Up Migration
-- Apple 5.1.1(v): erase account identifiers and the owner's own complaint and review content.
-- The account remains a disabled tombstone so its business records keep their links.

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

-- Owner order 2026-11-23 (Apple 5.1.1(v)): the erasure request. It is written only after the owner confirmed a one-time OTP sent to the phone
-- (the backend checks the OTP first). One row per request; anonymize_app_user accepts only a request that is still unused and not expired,
-- and uses it up in the same transaction. A request is bound to one account (user_id).
CREATE TABLE app.account_deletion_requests (
  request_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users (user_id),
  verification_id uuid NOT NULL UNIQUE,
  forfeit_vnd bigint NOT NULL DEFAULT 0 CHECK (forfeit_vnd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT account_deletion_requests_window_ck CHECK (expires_at > created_at),
  CONSTRAINT account_deletion_requests_consumed_ck CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);
-- Confirmation takes the user lock before inserting. Expired authorizations remain as history and do not block a new OTP.
CREATE INDEX account_deletion_requests_unused_idx ON app.account_deletion_requests (user_id, expires_at) WHERE consumed_at IS NULL;

-- The wallet adjustment source of the erasure: the forfeited balance (below the minimum withdrawal) is posted to the ledger like a complaint adjustment.
ALTER TABLE app.wallet_adjustments DROP CONSTRAINT wallet_adjustments_source_ck;
ALTER TABLE app.wallet_adjustments ADD CONSTRAINT wallet_adjustments_source_ck CHECK (source_type IN ('COMPLAINT', 'ACCOUNT_DELETE'));

CREATE FUNCTION app.anonymize_app_user(p_user_id uuid, p_password_hash text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_phone text;
  v_old_phone text;
  v_phones text[];
  v_keys uuid[];
  v_driver_id uuid;
  v_request_id uuid;
  v_expires_at timestamptz;
BEGIN
  PERFORM 1 FROM app.users WHERE user_id = p_user_id AND account_scope = 'APP_USER' AND anonymized_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  -- The gate: only an account with a valid, unused, unexpired erasure request may be anonymized, whoever calls (the request is consumed below).
  SELECT request_id, expires_at INTO v_request_id, v_expires_at
    FROM app.account_deletion_requests
   WHERE user_id = p_user_id AND consumed_at IS NULL AND expires_at > clock_timestamp()
   ORDER BY created_at DESC, request_id
   LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'ACCOUNT_ERASURE_NOT_REQUESTED: no valid, unused erasure request for this account' USING ERRCODE = 'restrict_violation';
  END IF;
  PERFORM set_config('app.account_anonymize', 'on', true);
  -- Read by the complaint-picture delete guard: only the pictures this account uploaded may go, in this transaction.
  PERFORM set_config('app.account_anonymize_user', p_user_id::text, true);
  SELECT phone_normalized INTO v_old_phone FROM app.users WHERE user_id = p_user_id;
  -- The phone in both forms (+84… and 0…) for the text and JSON scrubs below.
  v_phones := ARRAY[v_old_phone, '0' || substring(v_old_phone FROM 4)];
  v_phone := app.anonymized_phone_number();


  -- Remove authentication and push tokens; detach their delivery history first.
  UPDATE app.notification_pushes SET token_id = NULL WHERE recipient_user_id = p_user_id AND token_id IS NOT NULL;
  DELETE FROM app.notification_push_tokens WHERE user_id = p_user_id;
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

  -- A sole owner's shop profile can contain their account name, phone and picture.
  UPDATE app.shops s
     SET name = 'Cửa hàng đã ẩn danh', contact_phone_normalized = app.anonymized_phone_number(),
         logo = NULL, version = version + 1, updated_at = now()
   WHERE EXISTS (SELECT 1 FROM app.shop_members m WHERE m.shop_id = s.shop_id AND m.user_id = p_user_id AND m.member_role = 'OWNER')
     AND NOT EXISTS (SELECT 1 FROM app.shop_members m WHERE m.shop_id = s.shop_id AND m.user_id <> p_user_id);

  SELECT driver_id INTO v_driver_id FROM app.drivers WHERE user_id = p_user_id;
  UPDATE app.drivers SET full_name = 'Đã ẩn danh', version = version + 1, updated_at = now()
   WHERE driver_id = v_driver_id;

  DELETE FROM app.complaint_attachments WHERE uploader_user_id = p_user_id;
  -- OTP records of the phone. An SMS job cannot carry a placeholder number (sms_jobs_phone_ck: +84 only), so the account's queued or sent
  -- jobs are deleted with their encrypted payloads. The verification and proof rows keep their history under a placeholder number.
  DELETE FROM app.sms_jobs WHERE phone_normalized = v_old_phone AND verification_id IS NOT NULL;
  UPDATE app.verification_proofs SET phone_normalized = app.anonymized_phone_number() WHERE phone_normalized = v_old_phone;
  UPDATE app.phone_verifications SET phone_normalized = app.anonymized_phone_number() WHERE phone_normalized = v_old_phone;

  UPDATE app.complaints SET body = 'Đã ẩn danh', version = version + 1, updated_at = now()
   WHERE submitter_user_id = p_user_id AND body <> 'Đã ẩn danh';
  IF v_driver_id IS NOT NULL THEN
    UPDATE app.complaints SET driver_name = 'Đã ẩn danh', version = version + 1, updated_at = now()
     WHERE driver_id = v_driver_id AND driver_name IS DISTINCT FROM 'Đã ẩn danh';
  END IF;
  UPDATE app.complaint_messages SET body = 'Đã ẩn danh'
   WHERE author_user_id = p_user_id AND body IS NOT NULL AND body <> 'Đã ẩn danh';
  -- The review text of the account is replaced too (Owner decision 2026-11-23); the stars and the shop's side stay. A NULL text stays NULL.
  UPDATE app.reviews SET reviewer_name = 'Đã ẩn danh',
         comment = CASE WHEN comment IS NULL THEN NULL ELSE 'Đã ẩn danh' END,
         version = version + 1
   WHERE reviewer_user_id = p_user_id
     AND (reviewer_name <> 'Đã ẩn danh' OR (comment IS NOT NULL AND comment <> 'Đã ẩn danh'));
  UPDATE app.complaint_reconsiderations SET reason = 'Đã ẩn danh'
   WHERE requested_by = p_user_id AND reason <> 'Đã ẩn danh';

  -- Only account-level payloads are scrubbed. Business snapshots remain available for reconciliation.
  UPDATE app.outbox_events SET payload = app.anonymize_json(payload, v_phones)
   WHERE resource_type = 'user' AND resource_id = p_user_id::text;
  UPDATE app.audit_logs SET metadata = app.anonymize_json(metadata, v_phones)
   WHERE resource_type = 'user' AND resource_id = p_user_id::text;

  -- The account itself: a DISABLED tombstone under the same id. The real number is released; the placeholder cannot be dialled.
  UPDATE app.users SET phone_normalized = v_phone, password_hash = p_password_hash, status = 'DISABLED', lock_reason = 'DELETE_REQUEST',
         locked_at = now(), delete_requested_at = NULL, anonymized_at = now(), version = version + 1, updated_at = now()
   WHERE user_id = p_user_id;
  -- The request is used up in this same transaction: a second call (or a replay) finds nothing and is refused.
  UPDATE app.account_deletion_requests SET consumed_at = clock_timestamp() WHERE request_id = v_request_id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.anonymize_app_user(uuid, text) FROM PUBLIC;

-- Who may open the controlled exceptions. A transaction setting is not a proof: any session can run set_config, including the runtime
-- role ship11_app. So a flag counts only while the CURRENT role is the owner of app.anonymize_app_user (the migration role). Inside that
-- SECURITY DEFINER function, and inside the functions it calls, current_user is the owner; a runtime session is not. The guards run as the
-- invoking role, so these helpers keep the default PUBLIC EXECUTE (do not revoke it, or every guarded write would fail).
CREATE FUNCTION app.anonymize_definer_active() RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, app AS $$
  SELECT current_user = pg_get_userbyid(p.proowner)
    FROM pg_proc p
   WHERE p.oid = 'app.anonymize_app_user(uuid,text)'::regprocedure
$$;

CREATE FUNCTION app.account_anonymize_on() RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, app AS $$
  SELECT COALESCE(current_setting('app.account_anonymize', true), '') = 'on' AND app.anonymize_definer_active()
$$;


CREATE FUNCTION app.anon_pii_keys() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['phone', 'phone_normalized', 'name', 'full_name', 'email', 'avatar', 'avatar_url', 'password', 'password_hash', 'access_token', 'refresh_token', 'token']::text[]
$$;

-- The fixed values a personal text column may hold after the anonymization.
CREATE FUNCTION app.anon_value_ok(v text) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$
  SELECT v IS NULL OR v IN ('Đã ẩn danh', 'Cửa hàng đã ẩn danh', 'Tin nhắn đã ẩn danh')
$$;

-- True only while app.anonymize_app_user runs AND the write changes the listed fields and nothing else.
CREATE FUNCTION app.anon_only(old_row jsonb, new_row jsonb, fields text[]) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT app.account_anonymize_on() AND (new_row - fields) = (old_row - fields)
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
  fields text[] := TG_ARGV;
  f text;
BEGIN
  IF app.anon_only(to_jsonb(OLD), to_jsonb(NEW), fields) THEN
    FOREACH f IN ARRAY fields LOOP
      IF NOT (to_jsonb(NEW) ->> f = to_jsonb(OLD) ->> f OR app.anon_value_ok(to_jsonb(NEW) ->> f)) THEN
        RAISE EXCEPTION 'app.% is append-only (UPDATE rejected: % is not an anonymized value)', TG_TABLE_NAME, f USING ERRCODE = 'restrict_violation';
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'app.% is append-only (UPDATE rejected)', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END
$$;


CREATE OR REPLACE FUNCTION app.complaints_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Owner decision 2026-11-22 (account anonymization): only the personal text / names change, the version +1; nothing else.
  IF TG_OP = 'UPDATE' AND app.anon_only(to_jsonb(OLD), to_jsonb(NEW), ARRAY['body', 'driver_name', 'version', 'updated_at'])
     AND NEW.version = OLD.version + 1
     AND (NEW.body = OLD.body OR app.anon_value_ok(NEW.body))
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

-- Reviews: the reviewer's name and the review text may take their fixed value (the stars, the shop's side and the other fields stay).
CREATE OR REPLACE FUNCTION app.reviews_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND app.anon_only(to_jsonb(OLD), to_jsonb(NEW), ARRAY['reviewer_name', 'comment', 'version'])
     AND NEW.version = OLD.version + 1 AND (NEW.reviewer_name = OLD.reviewer_name OR app.anon_value_ok(NEW.reviewer_name))
     AND (NEW.comment IS NOT DISTINCT FROM OLD.comment OR NEW.comment = 'Đã ẩn danh') THEN
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
  IF TG_OP = 'UPDATE' AND app.account_anonymize_on() THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END
$$;

DROP TRIGGER complaint_messages_append_only ON app.complaint_messages;
CREATE TRIGGER complaint_messages_append_only BEFORE DELETE OR UPDATE OR TRUNCATE ON app.complaint_messages FOR EACH STATEMENT EXECUTE FUNCTION app.append_only_except_anonymize();
CREATE TRIGGER complaint_messages_anonymize BEFORE UPDATE ON app.complaint_messages FOR EACH ROW EXECUTE FUNCTION app.anon_row_guard('body');

-- Permit removal of only the erasing account's pictures, including those on open complaints.
CREATE OR REPLACE FUNCTION app.complaint_attachments_delete_guard() RETURNS trigger
  LANGUAGE plpgsql AS $function$
BEGIN
  IF app.account_anonymize_on()
     AND OLD.uploader_user_id::text = COALESCE(current_setting('app.account_anonymize_user', true), '') THEN
    RETURN OLD;
  END IF;
  IF OLD.complaint_id IS NOT NULL OR OLD.created_at > clock_timestamp() - interval '24 hours' THEN
    RAISE EXCEPTION 'app.complaint_attachments: only an unlinked picture older than 24 hours may be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$function$;

-- Reconsideration reasons (complaint_reconsiderations): the reason text of the account's own request; every other rule stays.
CREATE OR REPLACE FUNCTION app.complaint_reconsiderations_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND app.account_anonymize_on() AND app.anon_only(to_jsonb(OLD), to_jsonb(NEW), ARRAY['reason'])
     AND NEW.reason = 'Đã ẩn danh' THEN
    RETURN NEW;
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.complaint_reconsiderations is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.request_id <> OLD.request_id OR NEW.complaint_id <> OLD.complaint_id OR NEW.closure_no <> OLD.closure_no OR NEW.requested_by <> OLD.requested_by
     OR NEW.reason <> OLD.reason OR NEW.requested_at <> OLD.requested_at OR OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'RECONSIDERATION_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Account audit metadata may be scrubbed only inside the definer function.
CREATE OR REPLACE FUNCTION app.audit_logs_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND app.account_anonymize_on() THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'app.audit_logs is append-only (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END $$;

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

-- The erasure requests and the adjustment source go back first (the refusal above guarantees no anonymized account and so no erasure request in use).
DROP TABLE app.account_deletion_requests;
ALTER TABLE app.wallet_adjustments DROP CONSTRAINT wallet_adjustments_source_ck;
ALTER TABLE app.wallet_adjustments ADD CONSTRAINT wallet_adjustments_source_ck CHECK (source_type IN ('COMPLAINT'));

DROP TRIGGER complaint_messages_anonymize ON app.complaint_messages;
DROP TRIGGER complaint_messages_append_only ON app.complaint_messages;
CREATE TRIGGER complaint_messages_append_only BEFORE DELETE OR UPDATE OR TRUNCATE ON app.complaint_messages FOR EACH STATEMENT EXECUTE FUNCTION app.m11_append_only();

CREATE OR REPLACE FUNCTION app.audit_logs_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.audit_logs is append-only (% rejected)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE OR REPLACE FUNCTION app.complaint_reconsiderations_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.complaint_reconsiderations is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.request_id <> OLD.request_id OR NEW.complaint_id <> OLD.complaint_id OR NEW.closure_no <> OLD.closure_no OR NEW.requested_by <> OLD.requested_by
     OR NEW.reason <> OLD.reason OR NEW.requested_at <> OLD.requested_at OR OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'RECONSIDERATION_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP FUNCTION app.append_only_except_anonymize();

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

DROP FUNCTION app.anon_row_guard();
DROP FUNCTION app.anonymize_json(jsonb, text[]);
DROP FUNCTION app.anon_only(jsonb, jsonb, text[]);
DROP FUNCTION app.anon_value_ok(text);
DROP FUNCTION app.anon_pii_keys();

DROP FUNCTION app.anonymize_app_user(uuid, text);
DROP FUNCTION app.account_anonymize_on();
DROP FUNCTION app.anonymize_definer_active();
DROP FUNCTION app.anonymized_phone_number();
DROP SEQUENCE app.account_anonymized_phone_seq;
ALTER TABLE app.users DROP CONSTRAINT users_anonymized_ck;
ALTER TABLE app.users DROP COLUMN anonymized_at;
