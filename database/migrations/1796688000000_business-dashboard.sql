-- Up Migration
-- Additive finance conversations. No shop wallet, subscription, role grant or automatic activation.
CREATE TABLE app.business_finance_requests (
  request_id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('TOPUP', 'SHOP_PAYMENT')),
  owner_user_id uuid NOT NULL REFERENCES app.users(user_id),
  shop_id uuid REFERENCES app.shops(shop_id),
  amount_requested_vnd bigint NOT NULL CHECK (amount_requested_vnd BETWEEN 1 AND 9007199254740991),
  actual_amount_vnd bigint CHECK (actual_amount_vnd BETWEEN 1 AND 9007199254740991),
  state text NOT NULL CHECK (state IN ('PENDING','CONFIRMED','REJECTED','CANCELLED')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES app.users(user_id),
  reminded_at timestamptz,
  CHECK ((kind = 'SHOP_PAYMENT') = (shop_id IS NOT NULL)),
  CHECK ((state = 'PENDING') = (resolved_at IS NULL))
);
CREATE INDEX business_finance_pending_idx ON app.business_finance_requests(created_at, request_id) WHERE state = 'PENDING';
CREATE INDEX business_finance_owner_idx ON app.business_finance_requests(owner_user_id,created_at DESC,request_id);
CREATE SEQUENCE app.business_finance_message_seq;
CREATE FUNCTION app.next_business_message_sequence() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT nextval('app.business_finance_message_seq'::regclass)
$$;
REVOKE ALL ON FUNCTION app.next_business_message_sequence() FROM PUBLIC;
CREATE TABLE app.business_finance_messages (
  sequence_no bigint PRIMARY KEY DEFAULT app.next_business_message_sequence(),
  request_id uuid NOT NULL REFERENCES app.business_finance_requests(request_id),
  sender_user_id uuid REFERENCES app.users(user_id),
  sender_role text NOT NULL CHECK (sender_role IN ('SYSTEM_EVENT','SYSTEM','ADMIN','SHIPPER','SHOP')),
  body varchar(1000) NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  event_kind text NOT NULL DEFAULT 'MESSAGE' CHECK (event_kind IN ('MESSAGE','CREATED','STATE','OVERDUE')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX business_finance_messages_room_idx ON app.business_finance_messages(request_id,sequence_no);
CREATE TABLE app.business_finance_reads (
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  request_id uuid NOT NULL REFERENCES app.business_finance_requests(request_id),
  sequence_no bigint NOT NULL CHECK (sequence_no >= 0),
  PRIMARY KEY (user_id,request_id)
);
CREATE TABLE app.business_push_subscriptions (
  subscription_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  session_id uuid NOT NULL REFERENCES app.admin_sessions(session_id),
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE app.business_push_jobs (
  message_sequence bigint NOT NULL REFERENCES app.business_finance_messages(sequence_no),
  subscription_id uuid NOT NULL REFERENCES app.business_push_subscriptions(subscription_id),
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','SENT','FAILED','SKIPPED')),
  attempts integer NOT NULL DEFAULT 0,
  next_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  PRIMARY KEY (message_sequence,subscription_id)
);
CREATE INDEX business_push_due_idx ON app.business_push_jobs(next_at) WHERE state = 'PENDING';
-- A global receipt identity prevents reuse between shop payments and existing wallet credits.
CREATE TABLE app.business_bank_receipts (
  bank_id text NOT NULL,
  system_account_id uuid NOT NULL REFERENCES app.system_owned_bank_accounts(system_account_id),
  canonical_transaction_id text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('WALLET','SHOP_PAYMENT')),
  source_id uuid NOT NULL,
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  received_at timestamptz NOT NULL,
  PRIMARY KEY (bank_id,system_account_id,canonical_transaction_id),
  UNIQUE (source_kind,source_id)
);
INSERT INTO app.business_bank_receipts
SELECT bank_id,system_owned_account_id,canonical_transaction_id,'WALLET',bank_record_id,amount_vnd,occurred_at
FROM app.wallet_bank_transactions;
CREATE FUNCTION app.business_wallet_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  INSERT INTO app.business_bank_receipts VALUES
  (NEW.bank_id,NEW.system_owned_account_id,NEW.canonical_transaction_id,'WALLET',NEW.bank_record_id,NEW.amount_vnd,NEW.occurred_at);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.business_wallet_receipt() FROM PUBLIC;
CREATE TRIGGER business_wallet_receipt AFTER INSERT ON app.wallet_bank_transactions FOR EACH ROW EXECUTE FUNCTION app.business_wallet_receipt();
CREATE FUNCTION app.business_finance_message_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
REVOKE ALL ON FUNCTION app.business_finance_message_event() FROM PUBLIC;
CREATE TRIGGER business_finance_message_event AFTER INSERT ON app.business_finance_messages FOR EACH ROW EXECUTE FUNCTION app.business_finance_message_event();
CREATE FUNCTION app.business_finance_state_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
REVOKE ALL ON FUNCTION app.business_finance_state_event() FROM PUBLIC;
CREATE TRIGGER business_finance_state_event AFTER INSERT OR UPDATE OF state ON app.business_finance_requests FOR EACH ROW EXECUTE FUNCTION app.business_finance_state_event();
-- Trigger functions have a fixed search path and narrowly write only additive finance tables.
-- SECURITY DEFINER preserves old runtime writes during the migration-to-grants window and code rollback.
-- Top-up conversations follow the existing money service atomically, including cancels and retries.
CREATE FUNCTION app.business_topup_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  INSERT INTO app.business_finance_requests(request_id,kind,owner_user_id,amount_requested_vnd,actual_amount_vnd,state,version,created_at,resolved_at,resolved_by)
  VALUES(NEW.request_id,'TOPUP',NEW.created_by_user_id,NEW.amount_requested_vnd,(SELECT actual_amount_vnd FROM app.wallet_topups WHERE request_id=NEW.request_id),NEW.state,NEW.version,NEW.created_at,NEW.resolved_at,NEW.resolved_by_user_id)
  ON CONFLICT(request_id) DO UPDATE SET state=EXCLUDED.state,version=EXCLUDED.version,resolved_at=EXCLUDED.resolved_at,resolved_by=EXCLUDED.resolved_by,actual_amount_vnd=EXCLUDED.actual_amount_vnd;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.business_topup_sync() FROM PUBLIC;
CREATE TRIGGER business_topup_sync AFTER INSERT OR UPDATE OF state ON app.wallet_topup_requests FOR EACH ROW EXECUTE FUNCTION app.business_topup_sync();
INSERT INTO app.business_finance_requests(request_id,kind,owner_user_id,amount_requested_vnd,actual_amount_vnd,state,version,created_at,resolved_at,resolved_by)
SELECT r.request_id,'TOPUP',r.created_by_user_id,r.amount_requested_vnd,t.actual_amount_vnd,r.state,r.version,r.created_at,r.resolved_at,r.resolved_by_user_id FROM app.wallet_topup_requests r LEFT JOIN app.wallet_topups t ON t.request_id=r.request_id;
-- The evidence and receipt identity are append-only; no retention deletion of financial records.
CREATE FUNCTION app.business_finance_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Financial evidence is append-only' USING ERRCODE='restrict_violation';
END $$;
CREATE TRIGGER business_finance_messages_immutable BEFORE UPDATE OR DELETE ON app.business_finance_messages FOR EACH ROW EXECUTE FUNCTION app.business_finance_immutable();
CREATE TRIGGER business_bank_receipts_immutable BEFORE UPDATE OR DELETE ON app.business_bank_receipts FOR EACH ROW EXECUTE FUNCTION app.business_finance_immutable();

-- Down Migration
-- Keep the history check and DROP atomic against concurrent request/receipt writers.
LOCK TABLE app.business_finance_requests, app.business_bank_receipts IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM app.business_finance_requests) OR EXISTS(SELECT 1 FROM app.business_bank_receipts) THEN
    RAISE EXCEPTION 'BUSINESS_FINANCE_DOWN_REFUSED: financial history exists';
  END IF;
END $$;
DROP TRIGGER business_topup_sync ON app.wallet_topup_requests;
DROP FUNCTION app.business_topup_sync();
DROP TRIGGER business_wallet_receipt ON app.wallet_bank_transactions;
DROP FUNCTION app.business_wallet_receipt();
DROP TRIGGER business_finance_state_event ON app.business_finance_requests;
DROP FUNCTION app.business_finance_state_event();
DROP TRIGGER business_finance_message_event ON app.business_finance_messages;
DROP FUNCTION app.business_finance_message_event();
DROP TABLE app.business_push_jobs;
DROP TABLE app.business_push_subscriptions;
DROP TABLE app.business_finance_reads;
DROP TABLE app.business_finance_messages;
DROP FUNCTION app.next_business_message_sequence();
DROP SEQUENCE app.business_finance_message_seq;
DROP TABLE app.business_bank_receipts;
DROP FUNCTION app.business_finance_immutable();
DROP TABLE app.business_finance_requests;
