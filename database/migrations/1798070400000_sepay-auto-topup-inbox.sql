-- Up Migration
-- M04 SePay automatic top-up, step 1 (Issue #403; docs/tasks/M04-SePay-auto-topup-20261119.md).
-- Additive only: no earlier migration is edited, no enum is changed, nothing is truncated. The two CHECKs that name an actor are REPLACED
-- (same meaning for every existing row: an ended request or a topup has exactly one human resolver).
--
-- WHAT THIS ADDS
--   * an automated settlement actor: resolved_by_system / confirmed_by_system = 'SEPAY_WEBHOOK'. Exactly ONE of (user, system) is set on an
--     ended request and on a topup. No fake Administrator user is ever created or used for money that arrived by bank transfer.
--   * transfer_code_key               the NAP transfer code of a request, as a STORED generated column, UNIQUE across all requests, so a
--                                     code identifies at most one request (the webhook matches by exact key, never by amount or time).
--   * app.sepay_transfer_inbox        one row per verified SePay webhook event (UNIQUE on the integer webhook id). Raw fields only needed to
--                                     decide and to give an Administrator the evidence. No secret, no signature, no full payload.
--
-- Money rules are unchanged: every credit still goes through the one posting path (TopupPostingService), and the database still proves
-- one credit per topup, a CONFIRMED request only with its topup, and balance = SUM(ledger).

-- ---------------------------------------------------------------------------------------------------
-- 1. Automated settlement actor on requests
-- ---------------------------------------------------------------------------------------------------
DO $assert$
BEGIN
  IF EXISTS (SELECT 1 FROM app.wallet_topup_requests WHERE state <> 'PENDING' AND resolved_by_user_id IS NULL) THEN
    RAISE EXCEPTION 'SEPAY_AUTO_TOPUP_MIGRATION_REFUSED: an ended top-up request has no resolver' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$assert$;

ALTER TABLE app.wallet_topup_requests ADD COLUMN resolved_by_system varchar(32);
ALTER TABLE app.wallet_topup_requests ADD CONSTRAINT wallet_topup_requests_system_actor_ck
  CHECK (resolved_by_system IS NULL OR resolved_by_system = 'SEPAY_WEBHOOK');
ALTER TABLE app.wallet_topup_requests DROP CONSTRAINT wallet_topup_requests_resolved_ck;
ALTER TABLE app.wallet_topup_requests ADD CONSTRAINT wallet_topup_requests_resolved_ck CHECK (
  (state = 'PENDING' AND resolved_at IS NULL AND resolved_by_user_id IS NULL AND resolved_by_system IS NULL)
  OR (state <> 'PENDING' AND resolved_at IS NOT NULL AND ((resolved_by_user_id IS NULL) <> (resolved_by_system IS NULL)))
);

-- ---------------------------------------------------------------------------------------------------
-- 2. Transfer code key of a request (same derivation as topupTransferCodeOf in the backend)
-- ---------------------------------------------------------------------------------------------------
DO $assert$
BEGIN
  IF (SELECT count(*) FROM (SELECT 1 FROM app.wallet_topup_requests GROUP BY upper(left(replace(request_id::text, '-', ''), 10)) HAVING count(*) > 1) d) > 0 THEN
    RAISE EXCEPTION 'SEPAY_AUTO_TOPUP_MIGRATION_REFUSED: two top-up requests share a transfer code; resolve manually before migrating' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$assert$;

ALTER TABLE app.wallet_topup_requests ADD COLUMN transfer_code_key varchar(13)
  GENERATED ALWAYS AS ('NAP' || upper(left(replace(request_id::text, '-', ''), 10))) STORED;
CREATE UNIQUE INDEX wallet_topup_requests_transfer_code_uq ON app.wallet_topup_requests (transfer_code_key);

-- ---------------------------------------------------------------------------------------------------
-- 3. Automated settlement actor on topups (exactly one of the two resolvers)
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE app.wallet_topups ALTER COLUMN confirmed_by_user_id DROP NOT NULL;
ALTER TABLE app.wallet_topups ADD COLUMN confirmed_by_system varchar(32);
ALTER TABLE app.wallet_topups ADD CONSTRAINT wallet_topups_confirmed_actor_ck CHECK (
  ((confirmed_by_user_id IS NULL) <> (confirmed_by_system IS NULL))
  AND (confirmed_by_system IS NULL OR confirmed_by_system = 'SEPAY_WEBHOOK')
);

-- ---------------------------------------------------------------------------------------------------
-- 4. app.sepay_transfer_inbox
-- ---------------------------------------------------------------------------------------------------
-- topup_request_id has NO foreign key on purpose: the inbox then depends on no wallet table, so the older migrations' down scripts (which drop
-- those tables) keep working. The settlement code writes it only for a request it locked and confirmed in the same transaction.
-- RECEIVED -> CREDITED | NEEDS_ADMIN | IGNORED ; NEEDS_ADMIN -> CREDITED | IGNORED | NEEDS_ADMIN ; CREDITED and IGNORED are final.
CREATE TABLE app.sepay_transfer_inbox (
  inbox_id uuid NOT NULL,
  -- Exactly one source identifies an event: the webhook id (webhook path) or the transactions-API UUID (reconciliation path). Both may be
  -- present for the same event later; they are never compared with each other.
  webhook_event_id bigint,
  sepay_transaction_uuid uuid,
  gateway varchar(64) NOT NULL,
  account_number varchar(40) NOT NULL,
  transfer_type varchar(3) NOT NULL,
  transfer_amount_vnd bigint NOT NULL,
  transaction_at timestamptz NOT NULL,
  code varchar(64),
  content varchar(2000) NOT NULL,
  reference_code varchar(128) NOT NULL,
  state varchar(16) NOT NULL,
  reason_code varchar(64),
  topup_request_id uuid,
  received_at timestamptz NOT NULL,
  processed_at timestamptz,

  CONSTRAINT sepay_transfer_inbox_pkey PRIMARY KEY (inbox_id),
  CONSTRAINT sepay_transfer_inbox_event_uq UNIQUE (webhook_event_id),
  CONSTRAINT sepay_transfer_inbox_transaction_uq UNIQUE (sepay_transaction_uuid),
  CONSTRAINT sepay_transfer_inbox_source_ck CHECK (webhook_event_id IS NOT NULL OR sepay_transaction_uuid IS NOT NULL),
  CONSTRAINT sepay_transfer_inbox_event_ck CHECK (webhook_event_id >= 1),
  CONSTRAINT sepay_transfer_inbox_type_ck CHECK (transfer_type IN ('in', 'out')),
  CONSTRAINT sepay_transfer_inbox_amount_ck CHECK (transfer_amount_vnd > 0 AND transfer_amount_vnd <= 9007199254740991),
  CONSTRAINT sepay_transfer_inbox_state_ck CHECK (state IN ('RECEIVED', 'CREDITED', 'NEEDS_ADMIN', 'IGNORED')),
  CONSTRAINT sepay_transfer_inbox_processed_ck CHECK ((state = 'RECEIVED') = (processed_at IS NULL)),
  CONSTRAINT sepay_transfer_inbox_credit_ck CHECK ((state = 'CREDITED') = (topup_request_id IS NOT NULL)),
  CONSTRAINT sepay_transfer_inbox_reason_ck CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT sepay_transfer_inbox_time_ck CHECK (processed_at IS NULL OR processed_at >= received_at)
);
CREATE INDEX sepay_transfer_inbox_state_idx ON app.sepay_transfer_inbox (state, received_at);
-- The bank identity of one transfer (account, bank reference, amount, transaction time). A webhook and a reconciliation read of the same
-- transfer carry different identifiers but the same bank identity, so this unique key makes the second arrival a no-op. An empty bank
-- reference is not a key (it is held for an Administrator anyway), so it is excluded.
CREATE UNIQUE INDEX sepay_transfer_inbox_bank_uq ON app.sepay_transfer_inbox (account_number, reference_code, transfer_amount_vnd, transaction_at)
  WHERE reference_code <> '';

-- Cursor of the reconciliation job (one row for the company's SePay account). Written only after a whole run is committed; never reset silently.
CREATE TABLE app.sepay_reconciliation_cursor (
  cursor_key varchar(32) NOT NULL,
  last_transaction_uuid uuid,
  last_outcome varchar(32),
  last_run_at timestamptz,
  not_before_at timestamptz,
  updated_at timestamptz NOT NULL,
  CONSTRAINT sepay_reconciliation_cursor_pkey PRIMARY KEY (cursor_key),
  CONSTRAINT sepay_reconciliation_cursor_key_ck CHECK (cursor_key = 'SEPAY_COMPANY'),
  CONSTRAINT sepay_reconciliation_cursor_outcome_ck CHECK (last_outcome IS NULL OR last_outcome ~ '^[A-Z][A-Z0-9_]{0,31}$')
);
INSERT INTO app.sepay_reconciliation_cursor (cursor_key, updated_at) VALUES ('SEPAY_COMPANY', date_trunc('milliseconds', clock_timestamp()));

CREATE FUNCTION app.sepay_transfer_inbox_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'SEPAY_TRANSFER_INBOX_IS_EVIDENCE: rows are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.inbox_id IS DISTINCT FROM OLD.inbox_id OR NEW.webhook_event_id IS DISTINCT FROM OLD.webhook_event_id
     OR NEW.sepay_transaction_uuid IS DISTINCT FROM OLD.sepay_transaction_uuid
     OR NEW.transfer_amount_vnd <> OLD.transfer_amount_vnd
     OR NEW.account_number <> OLD.account_number OR NEW.transaction_at <> OLD.transaction_at OR NEW.received_at <> OLD.received_at
     OR NEW.content <> OLD.content OR NEW.reference_code <> OLD.reference_code THEN
    RAISE EXCEPTION 'SEPAY_TRANSFER_INBOX_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.state IN ('CREDITED', 'IGNORED') AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'SEPAY_TRANSFER_INBOX_STATE_FINAL' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sepay_transfer_inbox_guard BEFORE UPDATE ON app.sepay_transfer_inbox
  FOR EACH ROW EXECUTE FUNCTION app.sepay_transfer_inbox_guard();
CREATE TRIGGER sepay_transfer_inbox_no_delete BEFORE DELETE OR TRUNCATE ON app.sepay_transfer_inbox
  FOR EACH STATEMENT EXECUTE FUNCTION app.sepay_transfer_inbox_guard();

-- Down Migration
-- Only for disposable or experimental databases. Reverse order; no CASCADE, no IF EXISTS. It is REFUSED, data untouched, when any automatic
-- settlement or any inbox row exists: rollback for production is disabling SEPAY_AUTO_TOPUP_ENABLED, never dropping history.
LOCK TABLE app.wallet_topup_requests, app.wallet_topups, app.sepay_transfer_inbox IN ACCESS EXCLUSIVE MODE;
DO $latch$
DECLARE
  inbox_rows bigint;
  system_requests bigint;
  system_topups bigint;
BEGIN
  SELECT count(*) INTO inbox_rows FROM app.sepay_transfer_inbox;
  SELECT count(*) INTO system_requests FROM app.wallet_topup_requests WHERE resolved_by_system IS NOT NULL;
  SELECT count(*) INTO system_topups FROM app.wallet_topups WHERE confirmed_by_system IS NOT NULL;
  IF inbox_rows > 0 OR system_requests > 0 OR system_topups > 0 THEN
    RAISE EXCEPTION 'SEPAY_AUTO_TOPUP_DOWN_REFUSED: % inbox row(s), % automatic request resolution(s), % automatic topup(s) exist; history is never dropped',
      inbox_rows, system_requests, system_topups USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$latch$;
DO $latch_cursor$
BEGIN
  IF EXISTS (SELECT 1 FROM app.sepay_reconciliation_cursor WHERE last_transaction_uuid IS NOT NULL) THEN
    RAISE EXCEPTION 'SEPAY_AUTO_TOPUP_DOWN_REFUSED: the reconciliation cursor has advanced; history is never dropped' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$latch_cursor$;
DROP TABLE app.sepay_reconciliation_cursor;
DROP TRIGGER sepay_transfer_inbox_no_delete ON app.sepay_transfer_inbox;
DROP TRIGGER sepay_transfer_inbox_guard ON app.sepay_transfer_inbox;
DROP FUNCTION app.sepay_transfer_inbox_guard();
DROP INDEX app.sepay_transfer_inbox_bank_uq;
DROP TABLE app.sepay_transfer_inbox;
ALTER TABLE app.wallet_topups DROP CONSTRAINT wallet_topups_confirmed_actor_ck;
ALTER TABLE app.wallet_topups DROP COLUMN confirmed_by_system;
ALTER TABLE app.wallet_topups ALTER COLUMN confirmed_by_user_id SET NOT NULL;
DROP INDEX app.wallet_topup_requests_transfer_code_uq;
ALTER TABLE app.wallet_topup_requests DROP COLUMN transfer_code_key;
ALTER TABLE app.wallet_topup_requests DROP CONSTRAINT wallet_topup_requests_resolved_ck;
ALTER TABLE app.wallet_topup_requests ADD CONSTRAINT wallet_topup_requests_resolved_ck CHECK (
  (state = 'PENDING' AND resolved_at IS NULL AND resolved_by_user_id IS NULL)
  OR (state <> 'PENDING' AND resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL)
);
ALTER TABLE app.wallet_topup_requests DROP CONSTRAINT wallet_topup_requests_system_actor_ck;
ALTER TABLE app.wallet_topup_requests DROP COLUMN resolved_by_system;
