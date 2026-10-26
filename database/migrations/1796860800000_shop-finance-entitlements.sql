-- Up Migration
-- Reuse the Business Dashboard receipt identity and rooms. No ledger/activation/fee/retention change.
ALTER TABLE app.business_finance_requests ADD COLUMN reported_at timestamptz;
-- Legacy messages remain readable; the API limits new messages to 500 Unicode graphemes.
ALTER TABLE app.business_finance_messages ALTER COLUMN body TYPE text;
ALTER TABLE app.business_finance_messages DROP CONSTRAINT business_finance_messages_body_check;
ALTER TABLE app.business_finance_messages ADD CONSTRAINT business_finance_messages_body_check CHECK (char_length(btrim(body)) >= 1);
CREATE INDEX business_finance_sender_time_idx ON app.business_finance_messages(sender_user_id,created_at) WHERE event_kind='MESSAGE';
CREATE TABLE app.shop_finance_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  visible_limit integer NOT NULL DEFAULT 20 CHECK(visible_limit BETWEEN 1 AND 300),
  messages_per_minute integer NOT NULL DEFAULT 5 CHECK(messages_per_minute BETWEEN 1 AND 60),
  version bigint NOT NULL DEFAULT 1 CHECK(version > 0)
);
INSERT INTO app.shop_finance_policy(singleton) VALUES(true);
CREATE TABLE app.shop_entitlement_grants (
  grant_id uuid NOT NULL,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  shop_id uuid NOT NULL,
  entitlement varchar(16) NOT NULL,
  action varchar(6) NOT NULL,
  reason varchar(300) NOT NULL,
  actor_user_id uuid NOT NULL,
  payment_request_id uuid,
  created_at timestamptz NOT NULL,

  CONSTRAINT shop_entitlement_grants_pkey PRIMARY KEY (grant_id),
  CONSTRAINT shop_entitlement_grants_seq_uq UNIQUE (seq),
  CONSTRAINT shop_entitlement_grants_shop_fk FOREIGN KEY (shop_id) REFERENCES app.shops (shop_id) ON DELETE RESTRICT,
  CONSTRAINT shop_entitlement_grants_actor_fk FOREIGN KEY (actor_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT shop_entitlement_grants_request_fk FOREIGN KEY (payment_request_id) REFERENCES app.business_finance_requests (request_id) ON DELETE RESTRICT,
  CONSTRAINT shop_entitlement_grants_entitlement_ck CHECK (entitlement IN ('MENU_EXPANDED')),
  CONSTRAINT shop_entitlement_grants_action_ck CHECK (action IN ('GRANT', 'REVOKE')),
  CONSTRAINT shop_entitlement_grants_reason_ck CHECK (reason = btrim(reason) AND char_length(reason) BETWEEN 3 AND 300),
  CONSTRAINT shop_entitlement_grants_payment_ck CHECK (payment_request_id IS NULL OR action = 'GRANT')
);
CREATE INDEX shop_entitlement_grants_shop_idx ON app.shop_entitlement_grants (shop_id, entitlement, seq DESC);
CREATE UNIQUE INDEX shop_entitlement_grants_payment_uq ON app.shop_entitlement_grants (payment_request_id) WHERE payment_request_id IS NOT NULL;
CREATE TRIGGER shop_entitlement_grants_immutable BEFORE UPDATE OR DELETE ON app.shop_entitlement_grants
  FOR EACH ROW EXECUTE FUNCTION app.business_finance_immutable();
CREATE TRIGGER shop_entitlement_grants_no_truncate BEFORE TRUNCATE ON app.shop_entitlement_grants
  FOR EACH STATEMENT EXECUTE FUNCTION app.business_finance_immutable();

-- A grant that names a payment request needs that request CONFIRMED (money recorded), and the sequence of a shop's rows must alternate: no GRANT on a granted
-- right, no REVOKE on a right that is not granted (the application checks under the shop lock; this is the database's own proof).
CREATE FUNCTION app.shop_entitlement_grants_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  request_state varchar(12);
  last_action varchar(6);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('entitlement|' || NEW.shop_id::text || '|' || NEW.entitlement, 0));
  IF NEW.payment_request_id IS NOT NULL THEN
    SELECT state INTO request_state FROM app.business_finance_requests WHERE request_id = NEW.payment_request_id AND shop_id = NEW.shop_id AND kind = 'SHOP_PAYMENT' FOR SHARE;
    IF request_state IS DISTINCT FROM 'CONFIRMED' THEN
      RAISE EXCEPTION 'SHOP_ENTITLEMENT_REQUIRES_CONFIRMED_PAYMENT' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  SELECT g.action INTO last_action FROM app.shop_entitlement_grants g WHERE g.shop_id = NEW.shop_id AND g.entitlement = NEW.entitlement ORDER BY g.seq DESC LIMIT 1;
  IF (NEW.action = 'GRANT' AND last_action = 'GRANT') OR (NEW.action = 'REVOKE' AND last_action IS DISTINCT FROM 'GRANT') THEN
    RAISE EXCEPTION 'SHOP_ENTITLEMENT_STATE_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER shop_entitlement_grants_guard BEFORE INSERT ON app.shop_entitlement_grants
  FOR EACH ROW EXECUTE FUNCTION app.shop_entitlement_grants_guard();

CREATE OR REPLACE FUNCTION app.business_finance_message_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  INSERT INTO app.business_push_jobs(message_sequence,subscription_id)
  SELECT NEW.sequence_no,s.subscription_id FROM app.business_push_subscriptions s
  JOIN app.admin_memberships m ON m.user_id=s.user_id AND m.status='ACTIVE'
  JOIN app.users u ON u.user_id=m.user_id AND u.status='ACTIVE'
  WHERE s.active AND s.user_id IS DISTINCT FROM NEW.sender_user_id
    AND (m.admin_role='SYSTEM' OR EXISTS (SELECT 1 FROM app.admin_finance_grants g
      WHERE g.user_id=m.user_id AND g.permission_key=(SELECT CASE kind WHEN 'TOPUP' THEN 'wallet.read' ELSE 'shop.payment.read' END FROM app.business_finance_requests WHERE request_id=NEW.request_id) AND g.state='GRANTED'));
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION app.business_finance_state_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO app.business_finance_messages(request_id,sender_role,body,event_kind)
    VALUES(NEW.request_id,'SYSTEM_EVENT',CASE NEW.state
      WHEN 'PENDING' THEN 'Yêu cầu đã được tạo. Báo đã chuyển sau khi chuyển khoản ngoài ứng dụng.'
      WHEN 'CONFIRMED' THEN 'Đã xác nhận tiền thực nhận.'
      WHEN 'REJECTED' THEN 'Yêu cầu bị từ chối. Xem trao đổi để biết chi tiết.'
      ELSE 'Yêu cầu đã hủy.' END,CASE WHEN TG_OP='INSERT' THEN 'CREATED' ELSE 'STATE' END);
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE app.notifications DROP CONSTRAINT notifications_target_ck;
ALTER TABLE app.notifications ADD CONSTRAINT notifications_target_ck CHECK(target_type IN ('ORDER','DELIVERY','WALLET_TXN','PROFILE','DELIVERY_LIST','NONE','COMPLAINT','FINANCE_REQUEST'));

-- Down Migration
LOCK TABLE app.shop_entitlement_grants, app.business_finance_requests, app.business_finance_messages, app.notifications IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM app.notifications WHERE target_type='FINANCE_REQUEST') OR EXISTS(SELECT 1 FROM app.shop_entitlement_grants) OR EXISTS(SELECT 1 FROM app.business_finance_requests WHERE reported_at IS NOT NULL)
 OR EXISTS(SELECT 1 FROM app.business_finance_messages WHERE char_length(body)>1000) THEN
 RAISE EXCEPTION 'SHOP_FINANCE_DOWN_REFUSED: preserve payment/entitlement/chat evidence';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION app.business_finance_message_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  INSERT INTO app.business_push_jobs(message_sequence,subscription_id)
  SELECT NEW.sequence_no,s.subscription_id FROM app.business_push_subscriptions s
  JOIN app.admin_memberships m ON m.user_id=s.user_id AND m.status='ACTIVE'
  JOIN app.users u ON u.user_id=m.user_id AND u.status='ACTIVE'
  WHERE s.active AND s.user_id IS DISTINCT FROM NEW.sender_user_id
    AND (m.admin_role='SYSTEM' OR EXISTS (SELECT 1 FROM app.admin_finance_grants g
      WHERE g.user_id=m.user_id AND g.permission_key='wallet.read' AND g.state='GRANTED'));
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION app.business_finance_state_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO app.business_finance_messages(request_id,sender_role,body,event_kind)
    VALUES(NEW.request_id,'SYSTEM_EVENT',CASE NEW.state
      WHEN 'PENDING' THEN 'Yêu cầu đã được gửi. Chờ kiểm tra tiền thực nhận.'
      WHEN 'CONFIRMED' THEN 'Đã xác nhận tiền thực nhận.'
      WHEN 'REJECTED' THEN 'Yêu cầu bị từ chối. Xem trao đổi để biết chi tiết.'
      ELSE 'Yêu cầu đã hủy.' END,CASE WHEN TG_OP='INSERT' THEN 'CREATED' ELSE 'STATE' END);
  END IF;
  RETURN NEW;
END $$;
DROP TABLE app.shop_entitlement_grants;
DROP FUNCTION app.shop_entitlement_grants_guard();
DROP TABLE app.shop_finance_policy;
DROP INDEX app.business_finance_sender_time_idx;
ALTER TABLE app.business_finance_requests DROP COLUMN reported_at;
ALTER TABLE app.business_finance_messages DROP CONSTRAINT business_finance_messages_body_check;
ALTER TABLE app.business_finance_messages ALTER COLUMN body TYPE varchar(1000);
ALTER TABLE app.business_finance_messages ADD CONSTRAINT business_finance_messages_body_check CHECK(char_length(btrim(body)) BETWEEN 1 AND 1000);
ALTER TABLE app.notifications DROP CONSTRAINT notifications_target_ck;
ALTER TABLE app.notifications ADD CONSTRAINT notifications_target_ck CHECK(target_type IN ('ORDER','DELIVERY','WALLET_TXN','PROFILE','DELIVERY_LIST','NONE','COMPLAINT'));
