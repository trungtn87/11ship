-- Up Migration
-- Issues #198 (PAY-SHOP-01) and #199 (FIN-CHAT-01). Forward-only and additive: new tables, functions and triggers, plus ONE widened CHECK of M08
-- (notifications_target_ck gains 'SHOP_PAYMENT'). No existing table, column, row or grant is altered; earlier migrations are not edited.
--
--  * #198: a shop reports an out-of-app bank transfer for a payment REQUEST (shop_payment_requests); an administrator checks the statement and records the money
--    RECEIVED once (shop_payment_settlements, immutable, bank transaction identity unique); granting a manual entitlement is a separate, logged act
--    (shop_entitlement_grants: an append-only list of GRANT / REVOKE, never a subscription clock). There is NO shop wallet, no renewal, no expiry, no period.
--  * #199: one text conversation per DRIVER_TOPUP (wallet_topup_requests) or SHOP_PAYMENT request (case_chat_messages). The milestones in the feed are projected from
--    the real rows when the feed is read; nothing is copied. A message never moves money, a balance or a right. wallet_topup_reports is the idempotent mark of
--    "Tôi đã chuyển khoản" for a Shipper top-up (the top-up request itself keeps its M04 guard untouched).

-- ---------------------------------------------------------------------------------------------------
-- Shared: rows of the tables below that are evidence are never rewritten or removed.
-- ---------------------------------------------------------------------------------------------------
CREATE FUNCTION app.payment_evidence_immutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is never changed or deleted (% rejected)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END
$$;

-- ---------------------------------------------------------------------------------------------------
-- app.shop_payment_requests (#198)
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.shop_payment_requests (
  request_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  purpose varchar(16) NOT NULL,
  amount_requested_vnd bigint NOT NULL,
  state varchar(12) NOT NULL DEFAULT 'PENDING',
  reject_reason_code varchar(24),
  created_by_user_id uuid NOT NULL,
  -- "Tôi đã chuyển khoản": one mark, written once. It is a notice to the administration and an event of the conversation; it confirms nothing.
  reported_at timestamptz,
  reported_by_user_id uuid,
  resolved_by_user_id uuid,
  resolved_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT shop_payment_requests_pkey PRIMARY KEY (request_id),
  CONSTRAINT shop_payment_requests_shop_uq UNIQUE (request_id, shop_id),
  CONSTRAINT shop_payment_requests_shop_fk FOREIGN KEY (shop_id) REFERENCES app.shops (shop_id) ON DELETE RESTRICT,
  CONSTRAINT shop_payment_requests_created_by_fk FOREIGN KEY (created_by_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT shop_payment_requests_reported_by_fk FOREIGN KEY (reported_by_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT shop_payment_requests_resolved_by_fk FOREIGN KEY (resolved_by_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT shop_payment_requests_purpose_ck CHECK (purpose IN ('ACCOUNT_OPENING', 'MENU_EXPANSION', 'OTHER')),
  CONSTRAINT shop_payment_requests_amount_ck CHECK (amount_requested_vnd > 0 AND amount_requested_vnd <= 9007199254740991),
  CONSTRAINT shop_payment_requests_state_ck CHECK (state IN ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT shop_payment_requests_reason_ck CHECK ((state = 'REJECTED') = (reject_reason_code IS NOT NULL) AND (reject_reason_code IS NULL OR reject_reason_code IN ('NOT_RECEIVED', 'AMOUNT_MISMATCH', 'DUPLICATE_REQUEST', 'INVALID_REQUEST', 'OTHER'))),
  CONSTRAINT shop_payment_requests_resolved_ck CHECK (
    (state = 'PENDING' AND resolved_at IS NULL AND resolved_by_user_id IS NULL)
    OR (state <> 'PENDING' AND resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL)
  ),
  CONSTRAINT shop_payment_requests_reported_ck CHECK ((reported_at IS NULL) = (reported_by_user_id IS NULL)),
  -- A request the shop already reported money for cannot be withdrawn: it is resolved by the administration (money may be on its way).
  CONSTRAINT shop_payment_requests_cancel_ck CHECK (state <> 'CANCELLED' OR reported_at IS NULL),
  CONSTRAINT shop_payment_requests_version_ck CHECK (version >= 1),
  CONSTRAINT shop_payment_requests_time_order_ck CHECK (updated_at >= created_at AND (resolved_at IS NULL OR resolved_at >= created_at) AND (reported_at IS NULL OR reported_at >= created_at))
);
CREATE INDEX shop_payment_requests_shop_idx ON app.shop_payment_requests (shop_id, created_at DESC, request_id DESC);
CREATE INDEX shop_payment_requests_queue_idx ON app.shop_payment_requests (state, reported_at, created_at DESC);
-- At most one open request per shop and purpose, so a retry with another key or a second tap cannot pile up demands.
CREATE UNIQUE INDEX shop_payment_requests_open_uq ON app.shop_payment_requests (shop_id, purpose) WHERE state = 'PENDING';

CREATE FUNCTION app.shop_payment_requests_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'PENDING' OR NEW.version <> 1 OR NEW.resolved_at IS NOT NULL OR NEW.reported_at IS NOT NULL THEN
      RAISE EXCEPTION 'SHOP_PAYMENT_REQUEST_MUST_START_PENDING' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.request_id <> OLD.request_id OR NEW.shop_id <> OLD.shop_id OR NEW.purpose <> OLD.purpose OR NEW.amount_requested_vnd <> OLD.amount_requested_vnd
     OR NEW.created_by_user_id <> OLD.created_by_user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOP_PAYMENT_REQUEST_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.state <> 'PENDING' THEN
    RAISE EXCEPTION 'SHOP_PAYMENT_REQUEST_TRANSITION_REFUSED: % -> %', OLD.state, NEW.state USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.state = 'PENDING' THEN
    -- The only change of a pending request: the first, single report mark.
    IF OLD.reported_at IS NOT NULL OR NEW.reported_at IS NULL THEN
      RAISE EXCEPTION 'SHOP_PAYMENT_REQUEST_TRANSITION_REFUSED: only the first report may change a pending request' USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF NEW.state IN ('CONFIRMED', 'REJECTED', 'CANCELLED') THEN
    IF NEW.reported_at IS DISTINCT FROM OLD.reported_at OR NEW.reported_by_user_id IS DISTINCT FROM OLD.reported_by_user_id THEN
      RAISE EXCEPTION 'SHOP_PAYMENT_REQUEST_REPORT_IMMUTABLE' USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'SHOP_PAYMENT_REQUEST_TRANSITION_REFUSED: % -> %', OLD.state, NEW.state USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'SHOP_PAYMENT_REQUEST_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER shop_payment_requests_guard BEFORE INSERT OR UPDATE ON app.shop_payment_requests
  FOR EACH ROW EXECUTE FUNCTION app.shop_payment_requests_guard();
CREATE TRIGGER shop_payment_requests_no_delete BEFORE DELETE OR TRUNCATE ON app.shop_payment_requests
  FOR EACH STATEMENT EXECUTE FUNCTION app.payment_evidence_immutable();

-- ---------------------------------------------------------------------------------------------------
-- app.shop_payment_settlements (#198): the proof that money was RECEIVED for a request. Written once with the CONFIRMED transition, never edited.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.shop_payment_settlements (
  settlement_id uuid NOT NULL,
  request_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  bank_id varchar(16) NOT NULL,
  system_owned_account_id uuid NOT NULL,
  canonical_transaction_id varchar(128) NOT NULL,
  amount_vnd bigint NOT NULL,
  received_at timestamptz NOT NULL,
  confirmed_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL,

  CONSTRAINT shop_payment_settlements_pkey PRIMARY KEY (settlement_id),
  -- One request has at most one proof of receipt.
  CONSTRAINT shop_payment_settlements_request_uq UNIQUE (request_id),
  CONSTRAINT shop_payment_settlements_request_fk FOREIGN KEY (request_id, shop_id) REFERENCES app.shop_payment_requests (request_id, shop_id) ON DELETE RESTRICT,
  CONSTRAINT shop_payment_settlements_account_fk FOREIGN KEY (system_owned_account_id, bank_id)
    REFERENCES app.system_owned_bank_accounts (system_account_id, bank_id) ON DELETE RESTRICT,
  CONSTRAINT shop_payment_settlements_confirmed_by_fk FOREIGN KEY (confirmed_by_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  -- A bank transaction is used for one payment, ever (the same identity rule as app.wallet_bank_transactions).
  CONSTRAINT shop_payment_settlements_identity_uq UNIQUE (bank_id, system_owned_account_id, canonical_transaction_id),
  CONSTRAINT shop_payment_settlements_txid_ck CHECK (
    canonical_transaction_id ~ '^[^[:space:][:cntrl:]]([^[:cntrl:]]*[^[:space:][:cntrl:]])?$' AND length(canonical_transaction_id) <= 128
  ),
  CONSTRAINT shop_payment_settlements_amount_ck CHECK (amount_vnd > 0 AND amount_vnd <= 9007199254740991)
);
CREATE INDEX shop_payment_settlements_shop_idx ON app.shop_payment_settlements (shop_id, created_at DESC);
CREATE TRIGGER shop_payment_settlements_immutable BEFORE UPDATE OR DELETE ON app.shop_payment_settlements
  FOR EACH ROW EXECUTE FUNCTION app.payment_evidence_immutable();
CREATE TRIGGER shop_payment_settlements_no_truncate BEFORE TRUNCATE ON app.shop_payment_settlements
  FOR EACH STATEMENT EXECUTE FUNCTION app.payment_evidence_immutable();

-- The same bank transaction can never settle a Shipper top-up AND a shop payment. Both inserts take the same advisory lock on the identity, then look at the
-- other table, so two concurrent confirmations (one of each kind) cannot both pass.
CREATE FUNCTION app.bank_identity_cross_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  clash boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('bank-tx|' || NEW.bank_id || '|' || NEW.system_owned_account_id::text || '|' || NEW.canonical_transaction_id, 0));
  IF TG_TABLE_NAME = 'shop_payment_settlements' THEN
    SELECT EXISTS (SELECT 1 FROM app.wallet_bank_transactions w WHERE w.bank_id = NEW.bank_id AND w.system_owned_account_id = NEW.system_owned_account_id AND w.canonical_transaction_id = NEW.canonical_transaction_id) INTO clash;
  ELSE
    SELECT EXISTS (SELECT 1 FROM app.shop_payment_settlements s WHERE s.bank_id = NEW.bank_id AND s.system_owned_account_id = NEW.system_owned_account_id AND s.canonical_transaction_id = NEW.canonical_transaction_id) INTO clash;
  END IF;
  IF clash THEN
    RAISE EXCEPTION 'BANK_TRANSACTION_ALREADY_RECORDED' USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER shop_payment_settlements_bank_cross BEFORE INSERT ON app.shop_payment_settlements
  FOR EACH ROW EXECUTE FUNCTION app.bank_identity_cross_guard();
CREATE TRIGGER wallet_bank_transactions_cross BEFORE INSERT ON app.wallet_bank_transactions
  FOR EACH ROW EXECUTE FUNCTION app.bank_identity_cross_guard();

-- A request is CONFIRMED exactly when its proof exists, proven again at COMMIT.
CREATE FUNCTION app.shop_payment_confirmed_check() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  request_state varchar(12);
  proofs bigint;
BEGIN
  IF TG_TABLE_NAME = 'shop_payment_settlements' THEN
    SELECT state INTO request_state FROM app.shop_payment_requests WHERE request_id = NEW.request_id;
    IF request_state IS DISTINCT FROM 'CONFIRMED' THEN
      RAISE EXCEPTION 'SHOP_PAYMENT_SETTLEMENT_REQUIRES_CONFIRMED_REQUEST' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.state = 'CONFIRMED' THEN
    SELECT count(*) INTO proofs FROM app.shop_payment_settlements WHERE request_id = NEW.request_id;
    IF proofs <> 1 THEN
      RAISE EXCEPTION 'SHOP_PAYMENT_CONFIRMED_REQUIRES_ONE_SETTLEMENT' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER shop_payment_settlements_confirmed AFTER INSERT ON app.shop_payment_settlements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.shop_payment_confirmed_check();
CREATE CONSTRAINT TRIGGER shop_payment_requests_confirmed AFTER INSERT OR UPDATE ON app.shop_payment_requests
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.shop_payment_confirmed_check();

-- ---------------------------------------------------------------------------------------------------
-- app.shop_entitlement_grants (#198): manual rights of a shop, an append-only list of GRANT / REVOKE. The current state of a right is its latest row.
-- There is no end date, no renewal and no clock. A GRANT may name the CONFIRMED payment request it follows, at most once per request.
-- ---------------------------------------------------------------------------------------------------
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
  CONSTRAINT shop_entitlement_grants_request_fk FOREIGN KEY (payment_request_id, shop_id) REFERENCES app.shop_payment_requests (request_id, shop_id) ON DELETE RESTRICT,
  CONSTRAINT shop_entitlement_grants_entitlement_ck CHECK (entitlement IN ('MENU_EXPANDED')),
  CONSTRAINT shop_entitlement_grants_action_ck CHECK (action IN ('GRANT', 'REVOKE')),
  CONSTRAINT shop_entitlement_grants_reason_ck CHECK (reason = btrim(reason) AND char_length(reason) BETWEEN 3 AND 300),
  CONSTRAINT shop_entitlement_grants_payment_ck CHECK (payment_request_id IS NULL OR action = 'GRANT')
);
CREATE INDEX shop_entitlement_grants_shop_idx ON app.shop_entitlement_grants (shop_id, entitlement, seq DESC);
CREATE UNIQUE INDEX shop_entitlement_grants_payment_uq ON app.shop_entitlement_grants (payment_request_id) WHERE payment_request_id IS NOT NULL;
CREATE TRIGGER shop_entitlement_grants_immutable BEFORE UPDATE OR DELETE ON app.shop_entitlement_grants
  FOR EACH ROW EXECUTE FUNCTION app.payment_evidence_immutable();
CREATE TRIGGER shop_entitlement_grants_no_truncate BEFORE TRUNCATE ON app.shop_entitlement_grants
  FOR EACH STATEMENT EXECUTE FUNCTION app.payment_evidence_immutable();

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
    SELECT state INTO request_state FROM app.shop_payment_requests WHERE request_id = NEW.payment_request_id FOR SHARE;
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

-- ---------------------------------------------------------------------------------------------------
-- app.wallet_topup_reports (#199): "Tôi đã chuyển khoản" of a Shipper top-up request, one immutable mark per request. It does not touch the request, the wallet
-- or the ledger: the M04 guard of wallet_topup_requests stays exactly as it was.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.wallet_topup_reports (
  request_id uuid NOT NULL,
  reported_by_user_id uuid NOT NULL,
  reported_at timestamptz NOT NULL,

  CONSTRAINT wallet_topup_reports_pkey PRIMARY KEY (request_id),
  CONSTRAINT wallet_topup_reports_request_fk FOREIGN KEY (request_id) REFERENCES app.wallet_topup_requests (request_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_topup_reports_user_fk FOREIGN KEY (reported_by_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT
);
CREATE TRIGGER wallet_topup_reports_immutable BEFORE UPDATE OR DELETE ON app.wallet_topup_reports
  FOR EACH ROW EXECUTE FUNCTION app.payment_evidence_immutable();
CREATE TRIGGER wallet_topup_reports_no_truncate BEFORE TRUNCATE ON app.wallet_topup_reports
  FOR EACH STATEMENT EXECUTE FUNCTION app.payment_evidence_immutable();

-- ---------------------------------------------------------------------------------------------------
-- app.case_chat_messages (#199): the typed messages of ONE payment request (a Shipper top-up or a shop payment). Separate from app.order_chat_messages.
-- No retention job and no DELETE exist: the retention period (90 days after the case closes was only a proposal) is not approved yet.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.case_chat_messages (
  message_id uuid NOT NULL,
  case_kind varchar(12) NOT NULL,
  topup_request_id uuid,
  shop_payment_id uuid,
  sender_user_id uuid NOT NULL,
  sender_role varchar(8) NOT NULL,
  sender_name varchar(120) NOT NULL,
  body varchar(500) NOT NULL,
  -- The Idempotency-Key of the send: one key is one message.
  client_key uuid NOT NULL,
  created_at timestamptz NOT NULL,

  CONSTRAINT case_chat_messages_pkey PRIMARY KEY (message_id),
  CONSTRAINT case_chat_messages_topup_fk FOREIGN KEY (topup_request_id) REFERENCES app.wallet_topup_requests (request_id) ON DELETE RESTRICT,
  CONSTRAINT case_chat_messages_shop_payment_fk FOREIGN KEY (shop_payment_id) REFERENCES app.shop_payment_requests (request_id) ON DELETE RESTRICT,
  CONSTRAINT case_chat_messages_sender_fk FOREIGN KEY (sender_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT case_chat_messages_case_ck CHECK (
    (case_kind = 'DRIVER_TOPUP' AND topup_request_id IS NOT NULL AND shop_payment_id IS NULL)
    OR (case_kind = 'SHOP_PAYMENT' AND shop_payment_id IS NOT NULL AND topup_request_id IS NULL)
  ),
  CONSTRAINT case_chat_messages_role_ck CHECK (sender_role IN ('SHIPPER', 'SHOP', 'ADMIN', 'SYSTEM')),
  CONSTRAINT case_chat_messages_role_kind_ck CHECK (
    (case_kind = 'DRIVER_TOPUP' AND sender_role IN ('SHIPPER', 'ADMIN', 'SYSTEM')) OR (case_kind = 'SHOP_PAYMENT' AND sender_role IN ('SHOP', 'ADMIN', 'SYSTEM'))
  ),
  CONSTRAINT case_chat_messages_body_ck CHECK (char_length(body) BETWEEN 1 AND 500 AND body = btrim(body)),
  CONSTRAINT case_chat_messages_client_key_uq UNIQUE (sender_user_id, client_key)
);
CREATE INDEX case_chat_messages_topup_idx ON app.case_chat_messages (topup_request_id, created_at DESC, message_id DESC) WHERE topup_request_id IS NOT NULL;
CREATE INDEX case_chat_messages_shop_payment_idx ON app.case_chat_messages (shop_payment_id, created_at DESC, message_id DESC) WHERE shop_payment_id IS NOT NULL;
CREATE INDEX case_chat_messages_sender_idx ON app.case_chat_messages (sender_user_id, created_at DESC);
CREATE TRIGGER case_chat_messages_immutable BEFORE UPDATE OR DELETE ON app.case_chat_messages
  FOR EACH ROW EXECUTE FUNCTION app.payment_evidence_immutable();
CREATE TRIGGER case_chat_messages_no_truncate BEFORE TRUNCATE ON app.case_chat_messages
  FOR EACH STATEMENT EXECUTE FUNCTION app.payment_evidence_immutable();

-- ---------------------------------------------------------------------------------------------------
-- M08: a notification may open a shop payment request (the only change to an earlier table: one CHECK constraint widened by one value).
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE app.notifications DROP CONSTRAINT notifications_target_ck;
ALTER TABLE app.notifications ADD CONSTRAINT notifications_target_ck
  CHECK (target_type IN ('ORDER', 'DELIVERY', 'WALLET_TXN', 'PROFILE', 'DELIVERY_LIST', 'NONE', 'COMPLAINT', 'SHOP_PAYMENT'));

-- Down Migration
-- Only for disposable test or experimental databases: refuses to run once a payment request, a proof, a grant, a report or a message exists (safety latch
-- PAYMENT_REQUESTS_DOWN_REFUSED). Restores the M08 constraint (refused while a SHOP_PAYMENT notification exists).
DO $latch$
DECLARE
  rows_found bigint;
BEGIN
  SELECT (SELECT count(*) FROM app.shop_payment_requests) + (SELECT count(*) FROM app.shop_payment_settlements) + (SELECT count(*) FROM app.shop_entitlement_grants)
       + (SELECT count(*) FROM app.wallet_topup_reports) + (SELECT count(*) FROM app.case_chat_messages) INTO rows_found;
  IF rows_found > 0 THEN
    RAISE EXCEPTION 'PAYMENT_REQUESTS_DOWN_REFUSED: % row(s) exist; payment evidence and chat history are not dropped by a migration', rows_found USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$latch$;
DELETE FROM app.notification_pushes WHERE notification_id IN (SELECT notification_id FROM app.notifications WHERE target_type = 'SHOP_PAYMENT');
DELETE FROM app.notifications WHERE target_type = 'SHOP_PAYMENT';
ALTER TABLE app.notifications DROP CONSTRAINT notifications_target_ck;
ALTER TABLE app.notifications ADD CONSTRAINT notifications_target_ck
  CHECK (target_type IN ('ORDER', 'DELIVERY', 'WALLET_TXN', 'PROFILE', 'DELIVERY_LIST', 'NONE', 'COMPLAINT'));
DROP TRIGGER wallet_bank_transactions_cross ON app.wallet_bank_transactions;
DROP TABLE app.case_chat_messages;
DROP TABLE app.wallet_topup_reports;
DROP TABLE app.shop_entitlement_grants;
DROP FUNCTION app.shop_entitlement_grants_guard();
DROP TABLE app.shop_payment_settlements;
DROP FUNCTION app.bank_identity_cross_guard();
DROP TABLE app.shop_payment_requests;
DROP FUNCTION app.shop_payment_confirmed_check();
DROP FUNCTION app.shop_payment_requests_guard();
DROP FUNCTION app.payment_evidence_immutable();
