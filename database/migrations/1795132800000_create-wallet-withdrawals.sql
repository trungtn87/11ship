-- Up Migration
-- M04-C: the Shipper withdrawal (manual bank transfer by an Admin), the OUT side of the bank registry, the versioned commission policy
-- (Issue #136, ADR-004 sections 4, 5, 7 and 9; docs/current/M04-C-withdrawal-completion-20261018.md).
--
-- WHAT THIS ADDS (additive; nothing is dropped, rewritten or truncated; earlier migrations are not edited; no CASCADE):
--   * app.wallet_commission_policies  append-only versions of the commission per successful delivery (version 1 = 1.000 VND, the amount M07 has used since it was
--                                     written). The amount of an assignment is snapshotted on it when it is accepted, so a new version only reaches assignments
--                                     accepted AFTER it: no hold, capture or release ever reads the current policy.
--   * app.wallet_withdrawals          one row per withdrawal REQUEST: an IMMUTABLE bank snapshot taken at creation, the amount, the state machine
--                                     PENDING -> PROCESSING -> PAID | RECONCILIATION, PENDING -> CANCELLED, RECONCILIATION -> PAID | CANCELLED, never a way back.
--   * app.wallet_withdrawal_events    the append-only trail of every transition (who, from, to, reason code). No bank detail in it.
--   * the WITHDRAWAL hold             wallet_holds_source_gate() now also admits a WITHDRAWAL hold, only for a PENDING withdrawal of the same wallet and amount.
--   * the WITHDRAWAL_DEBIT ledger kind wallet_ledger_source_gate() now also admits it, only for a withdrawal whose hold is already CAPTURED for exactly that amount.
--   * the OUT bank record             wallet_bank_transactions_gate() admits an OUT record only for a PROCESSING or RECONCILIATION withdrawal. The canonical identity
--                                     (bank, system account, transaction id) is the SAME unique key as for money received: one bank transaction, recorded once, whoever
--                                     records it and in whichever direction.
--
-- THE MONEY RULES, all enforced by the database at COMMIT (wallet_withdrawal_assert, deferred constraint triggers on the withdrawal, its hold, its ledger debit and
-- its bank record):
--   PENDING / PROCESSING / RECONCILIATION  exactly one ACTIVE WITHDRAWAL hold of the same wallet and amount, no debit
--   PAID                                   the hold CAPTURED, exactly ONE WITHDRAWAL_DEBIT of exactly the amount, an OUT bank record of exactly the amount
--   CANCELLED                              the hold RELEASED, no debit
--   plus the wallet invariants of A1/A2.1 (balance = SUM(ledger), held = SUM(ACTIVE holds)).
-- Reserve and release never write the ledger. A withdrawal cannot be PAID without its debit nor debited without being PAID.

-- ---------------------------------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------------------------------
CREATE FUNCTION app.wallet_withdrawal_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;

-- ---------------------------------------------------------------------------------------------------
-- app.wallet_commission_policies
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.wallet_commission_policies (
  policy_version integer NOT NULL,
  commission_vnd bigint NOT NULL,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL,

  CONSTRAINT wallet_commission_policies_pkey PRIMARY KEY (policy_version),
  CONSTRAINT wallet_commission_policies_version_ck CHECK (policy_version >= 1),
  -- Same ceiling as the wallet parameters (1 billion VND). The label stored on an assignment is COMMISSION_V<version> (<= 24 characters).
  CONSTRAINT wallet_commission_policies_amount_ck CHECK (commission_vnd >= 1 AND commission_vnd <= 1000000000),
  CONSTRAINT wallet_commission_policies_by_fk FOREIGN KEY (created_by_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  -- Version 1 is the seeded one (no author); every later version names the SYSTEM administrator who made it.
  CONSTRAINT wallet_commission_policies_author_ck CHECK ((policy_version = 1) = (created_by_user_id IS NULL))
);

-- Versions are consecutive: a writer serialises on the table lock and must insert exactly last + 1 (so two concurrent writers cannot both be "the next one").
CREATE FUNCTION app.wallet_commission_policies_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  last_version integer;
BEGIN
  LOCK TABLE app.wallet_commission_policies IN SHARE ROW EXCLUSIVE MODE;
  SELECT COALESCE(MAX(policy_version), 0) INTO last_version FROM app.wallet_commission_policies;
  IF NEW.policy_version <> last_version + 1 THEN
    RAISE EXCEPTION 'WALLET_COMMISSION_POLICY_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wallet_commission_policies_guard BEFORE INSERT ON app.wallet_commission_policies
  FOR EACH ROW EXECUTE FUNCTION app.wallet_commission_policies_guard();
CREATE TRIGGER wallet_commission_policies_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON app.wallet_commission_policies
  FOR EACH STATEMENT EXECUTE FUNCTION app.wallet_withdrawal_reject_mutation();

INSERT INTO app.wallet_commission_policies (policy_version, commission_vnd, created_by_user_id, created_at)
VALUES (1, 1000, NULL, date_trunc('milliseconds', clock_timestamp()));

-- ---------------------------------------------------------------------------------------------------
-- app.wallet_withdrawals
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.wallet_withdrawals (
  withdrawal_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  hold_id uuid NOT NULL,
  amount_vnd bigint NOT NULL,
  state varchar(14) NOT NULL DEFAULT 'PENDING',
  version bigint NOT NULL DEFAULT 1,
  -- The payout destination exactly as the Shipper's VERIFIED bank account was at creation. Immutable: a later bank change never rewrites it (account_number is text:
  -- a leading zero is kept). bank_snapshot_at is the updated_at of that bank account row (its "version"); it is compared with the live row before processing.
  bank_code varchar(16) NOT NULL,
  bank_name varchar(120) NOT NULL,
  account_number varchar(20) NOT NULL,
  account_holder varchar(120) NOT NULL,
  bank_snapshot_at timestamptz NOT NULL,
  bank_verified_at timestamptz NOT NULL,
  created_by_user_id uuid NOT NULL,
  -- The ONE administrator who claimed the transfer, and this claim (attempt). Written once, at PENDING -> PROCESSING.
  processing_owner_user_id uuid,
  processing_attempt_id uuid,
  processing_started_at timestamptz,
  -- Why the outcome is not known (set at PROCESSING -> RECONCILIATION).
  reconciliation_reason varchar(24),
  reconciliation_reported_by_user_id uuid,
  reconciliation_reported_at timestamptz,
  -- The outgoing bank transaction, in the shared registry (OUT). Set once, when it is recorded (reconciliation with evidence, or PAID).
  bank_record_id uuid,
  -- How it ended: PAID (money sent), CANCELLED_BY_SHIPPER (while PENDING) or CONFIRMED_NOT_SENT_FINAL (reconciled: certainly never sent).
  outcome varchar(24),
  resolved_by_user_id uuid,
  resolved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT wallet_withdrawals_pkey PRIMARY KEY (withdrawal_id),
  CONSTRAINT wallet_withdrawals_owner_fk FOREIGN KEY (wallet_id, driver_id) REFERENCES app.driver_wallets (wallet_id, driver_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_withdrawals_driver_fk FOREIGN KEY (driver_id) REFERENCES app.drivers (driver_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_withdrawals_created_by_fk FOREIGN KEY (created_by_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_withdrawals_owner_user_fk FOREIGN KEY (processing_owner_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_withdrawals_reported_by_fk FOREIGN KEY (reconciliation_reported_by_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_withdrawals_resolved_by_fk FOREIGN KEY (resolved_by_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_withdrawals_hold_uq UNIQUE (hold_id),
  CONSTRAINT wallet_withdrawals_bank_record_uq UNIQUE (bank_record_id),
  CONSTRAINT wallet_withdrawals_wallet_uq UNIQUE (withdrawal_id, wallet_id),
  CONSTRAINT wallet_withdrawals_amount_ck CHECK (amount_vnd > 0 AND amount_vnd <= 9007199254740991),
  CONSTRAINT wallet_withdrawals_state_ck CHECK (state IN ('PENDING', 'PROCESSING', 'RECONCILIATION', 'PAID', 'CANCELLED')),
  CONSTRAINT wallet_withdrawals_version_ck CHECK (version >= 1),
  CONSTRAINT wallet_withdrawals_bank_code_ck CHECK (bank_code ~ '^[A-Z0-9]{2,16}$'),
  CONSTRAINT wallet_withdrawals_number_ck CHECK (account_number ~ '^[0-9]{6,20}$'),
  CONSTRAINT wallet_withdrawals_holder_ck CHECK (length(btrim(account_holder)) >= 1),
  CONSTRAINT wallet_withdrawals_reason_ck CHECK (reconciliation_reason IS NULL OR reconciliation_reason IN ('UNKNOWN_OUTCOME', 'AMOUNT_MISMATCH', 'DESTINATION_MISMATCH', 'TAKEOVER_NEEDED')),
  CONSTRAINT wallet_withdrawals_outcome_ck CHECK (outcome IS NULL OR outcome IN ('PAID', 'CANCELLED_BY_SHIPPER', 'CONFIRMED_NOT_SENT_FINAL')),
  CONSTRAINT wallet_withdrawals_time_order_ck CHECK (updated_at >= created_at AND (resolved_at IS NULL OR resolved_at >= created_at)),
  -- The fields that belong to each state, and only those (the claim, the reconciliation, the outgoing record and the resolution never appear early or half).
  CONSTRAINT wallet_withdrawals_claim_ck CHECK (
    (processing_owner_user_id IS NULL AND processing_attempt_id IS NULL AND processing_started_at IS NULL)
    OR (processing_owner_user_id IS NOT NULL AND processing_attempt_id IS NOT NULL AND processing_started_at IS NOT NULL)
  ),
  CONSTRAINT wallet_withdrawals_reconciliation_ck CHECK (
    (reconciliation_reason IS NULL AND reconciliation_reported_by_user_id IS NULL AND reconciliation_reported_at IS NULL)
    OR (reconciliation_reason IS NOT NULL AND reconciliation_reported_by_user_id IS NOT NULL AND reconciliation_reported_at IS NOT NULL)
  ),
  CONSTRAINT wallet_withdrawals_resolution_ck CHECK (
    (resolved_at IS NULL AND resolved_by_user_id IS NULL AND outcome IS NULL)
    OR (resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL AND outcome IS NOT NULL)
  ),
  CONSTRAINT wallet_withdrawals_state_fields_ck CHECK (
    (state = 'PENDING' AND processing_owner_user_id IS NULL AND reconciliation_reason IS NULL AND bank_record_id IS NULL AND resolved_at IS NULL AND paid_at IS NULL)
    OR (state = 'PROCESSING' AND processing_owner_user_id IS NOT NULL AND reconciliation_reason IS NULL AND bank_record_id IS NULL AND resolved_at IS NULL AND paid_at IS NULL)
    OR (state = 'RECONCILIATION' AND processing_owner_user_id IS NOT NULL AND reconciliation_reason IS NOT NULL AND resolved_at IS NULL AND paid_at IS NULL)
    OR (state = 'PAID' AND processing_owner_user_id IS NOT NULL AND bank_record_id IS NOT NULL AND outcome = 'PAID' AND paid_at IS NOT NULL)
    OR (state = 'CANCELLED' AND bank_record_id IS NULL AND paid_at IS NULL AND (
          (outcome = 'CANCELLED_BY_SHIPPER' AND processing_owner_user_id IS NULL AND reconciliation_reason IS NULL)
          OR (outcome = 'CONFIRMED_NOT_SENT_FINAL' AND processing_owner_user_id IS NOT NULL AND reconciliation_reason IS NOT NULL)))
  )
);
CREATE INDEX wallet_withdrawals_wallet_state_idx ON app.wallet_withdrawals (wallet_id, state);
CREATE INDEX wallet_withdrawals_state_created_idx ON app.wallet_withdrawals (state, created_at DESC, withdrawal_id DESC);

-- The state machine and the immutable fields. The wallet row lock first (as the holds do), so even a writer that forgot it is serialised per wallet.
CREATE FUNCTION app.wallet_withdrawals_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
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
$$;
CREATE TRIGGER wallet_withdrawals_guard BEFORE INSERT OR UPDATE ON app.wallet_withdrawals
  FOR EACH ROW EXECUTE FUNCTION app.wallet_withdrawals_guard();
CREATE TRIGGER wallet_withdrawals_no_delete BEFORE DELETE OR TRUNCATE ON app.wallet_withdrawals
  FOR EACH STATEMENT EXECUTE FUNCTION app.wallet_withdrawal_reject_mutation();

-- ---------------------------------------------------------------------------------------------------
-- app.wallet_withdrawal_events: the trail (append-only; reasons are codes, never free text, never a bank detail)
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.wallet_withdrawal_events (
  event_id uuid NOT NULL,
  withdrawal_id uuid NOT NULL,
  kind varchar(32) NOT NULL,
  from_state varchar(14),
  to_state varchar(14) NOT NULL,
  actor_user_id uuid NOT NULL,
  reason_code varchar(32),
  withdrawal_version bigint NOT NULL,
  created_at timestamptz NOT NULL,

  CONSTRAINT wallet_withdrawal_events_pkey PRIMARY KEY (event_id),
  CONSTRAINT wallet_withdrawal_events_withdrawal_fk FOREIGN KEY (withdrawal_id) REFERENCES app.wallet_withdrawals (withdrawal_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_withdrawal_events_actor_fk FOREIGN KEY (actor_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_withdrawal_events_kind_ck CHECK (kind IN ('CREATED', 'CANCELLED', 'PROCESSING_STARTED', 'PAID', 'RECONCILIATION_REPORTED', 'RECONCILIATION_UNKNOWN', 'RECONCILED_PAID', 'RECONCILED_NOT_SENT')),
  CONSTRAINT wallet_withdrawal_events_reason_ck CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z0-9_]{2,32}$'),
  CONSTRAINT wallet_withdrawal_events_version_ck CHECK (withdrawal_version >= 1)
);
CREATE INDEX wallet_withdrawal_events_withdrawal_idx ON app.wallet_withdrawal_events (withdrawal_id, created_at, event_id);
CREATE TRIGGER wallet_withdrawal_events_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON app.wallet_withdrawal_events
  FOR EACH STATEMENT EXECUTE FUNCTION app.wallet_withdrawal_reject_mutation();

-- ---------------------------------------------------------------------------------------------------
-- The typed sources of a WITHDRAWAL hold, of the WITHDRAWAL_DEBIT ledger row and of the OUT bank record
-- ---------------------------------------------------------------------------------------------------
-- Compatibility, not emptiness: nothing of the withdrawal kind could be written before this migration.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM app.wallet_holds WHERE purpose = 'WITHDRAWAL')
     OR EXISTS (SELECT 1 FROM app.wallet_ledger_entries WHERE entry_kind = 'WITHDRAWAL_DEBIT')
     OR EXISTS (SELECT 1 FROM app.wallet_bank_transactions WHERE direction = 'OUT') THEN
    RAISE EXCEPTION 'M04C_MIGRATION_REFUSED: withdrawal, adjustment or outgoing rows exist but no source existed before this migration' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$guard$;

-- The withdrawal and its hold point at each other; both directions DEFERRABLE INITIALLY DEFERRED so the two rows can be written in one transaction in either order. These cyclic links use
-- the default NO ACTION (checked at COMMIT, so a delete of either side is still refused): RESTRICT cannot be deferred and would make the cycle unwritable in one order.
ALTER TABLE app.wallet_withdrawals ADD CONSTRAINT wallet_withdrawals_hold_fk
  FOREIGN KEY (hold_id) REFERENCES app.wallet_holds (hold_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app.wallet_holds ADD CONSTRAINT wallet_holds_withdrawal_fk
  FOREIGN KEY (withdrawal_id) REFERENCES app.wallet_withdrawals (withdrawal_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE app.wallet_ledger_entries ADD COLUMN withdrawal_id uuid;
ALTER TABLE app.wallet_ledger_entries ADD CONSTRAINT wallet_ledger_entries_withdrawal_source_ck CHECK ((entry_kind = 'WITHDRAWAL_DEBIT') = (withdrawal_id IS NOT NULL));
ALTER TABLE app.wallet_ledger_entries ADD CONSTRAINT wallet_ledger_entries_withdrawal_uq UNIQUE (withdrawal_id);
ALTER TABLE app.wallet_ledger_entries ADD CONSTRAINT wallet_ledger_entries_withdrawal_fk
  FOREIGN KEY (withdrawal_id, wallet_id) REFERENCES app.wallet_withdrawals (withdrawal_id, wallet_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE app.wallet_bank_transactions ADD CONSTRAINT wallet_bank_transactions_withdrawal_fk
  FOREIGN KEY (withdrawal_id) REFERENCES app.wallet_withdrawals (withdrawal_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app.wallet_withdrawals ADD CONSTRAINT wallet_withdrawals_bank_record_fk
  FOREIGN KEY (bank_record_id) REFERENCES app.wallet_bank_transactions (bank_record_id) DEFERRABLE INITIALLY DEFERRED;

-- The hold gate: COMMISSION as M07 opened it, plus a WITHDRAWAL hold for a PENDING withdrawal of the same wallet, the same amount and this very hold.
CREATE OR REPLACE FUNCTION app.wallet_holds_source_gate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.purpose = 'COMMISSION' AND NEW.commission_assignment_id IS NOT NULL AND EXISTS (
       SELECT 1
         FROM app.delivery_assignments a
         JOIN app.driver_wallets w ON w.driver_id = a.driver_id
        WHERE a.assignment_id = NEW.commission_assignment_id
          AND w.wallet_id = NEW.wallet_id
          AND a.commission_vnd = NEW.amount_vnd
          AND a.status = 'ACTIVE') THEN
    RETURN NEW;
  END IF;
  IF NEW.purpose = 'WITHDRAWAL' AND NEW.withdrawal_id IS NOT NULL AND EXISTS (
       SELECT 1
         FROM app.wallet_withdrawals d
        WHERE d.withdrawal_id = NEW.withdrawal_id
          AND d.hold_id = NEW.hold_id
          AND d.wallet_id = NEW.wallet_id
          AND d.amount_vnd = NEW.amount_vnd
          AND d.state = 'PENDING') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'WALLET_HOLD_SOURCE_NOT_AVAILABLE: a hold needs a valid business source and none exists yet'
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- The ledger gate: TOPUP and COMMISSION_DEBIT as before, plus a WITHDRAWAL_DEBIT whose hold is already CAPTURED for exactly that amount. ADJUSTMENT_* stays refused.
CREATE OR REPLACE FUNCTION app.wallet_ledger_source_gate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entry_kind = 'TOPUP' AND NEW.topup_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM app.wallet_topups t
        WHERE t.topup_id = NEW.topup_id AND t.wallet_id = NEW.wallet_id AND t.actual_amount_vnd = NEW.delta_vnd
     ) THEN
    RETURN NEW;
  END IF;
  IF NEW.entry_kind = 'COMMISSION_DEBIT' AND NEW.commission_assignment_id IS NOT NULL AND EXISTS (
       SELECT 1
         FROM app.wallet_holds h
        WHERE h.commission_assignment_id = NEW.commission_assignment_id
          AND h.wallet_id = NEW.wallet_id
          AND h.purpose = 'COMMISSION'
          AND h.status = 'CAPTURED'
          AND h.amount_vnd = -NEW.delta_vnd) THEN
    RETURN NEW;
  END IF;
  IF NEW.entry_kind = 'WITHDRAWAL_DEBIT' AND NEW.withdrawal_id IS NOT NULL AND EXISTS (
       SELECT 1
         FROM app.wallet_holds h
         JOIN app.wallet_withdrawals d ON d.withdrawal_id = h.withdrawal_id AND d.hold_id = h.hold_id
        WHERE h.withdrawal_id = NEW.withdrawal_id
          AND h.wallet_id = NEW.wallet_id
          AND d.wallet_id = NEW.wallet_id
          AND h.purpose = 'WITHDRAWAL'
          AND h.status = 'CAPTURED'
          AND h.amount_vnd = -NEW.delta_vnd
          AND d.amount_vnd = h.amount_vnd) THEN
    RETURN NEW;
  END IF;
  IF NEW.entry_kind IN ('ADJUSTMENT_CREDIT', 'ADJUSTMENT_DEBIT') AND NEW.adjustment_id IS NOT NULL AND EXISTS (
       SELECT 1
         FROM app.wallet_adjustments a
        WHERE a.adjustment_id = NEW.adjustment_id
          AND a.wallet_id = NEW.wallet_id
          AND a.amount_vnd = abs(NEW.delta_vnd)
          AND ((a.direction = 'REFUND_TO_SHIPPER' AND NEW.entry_kind = 'ADJUSTMENT_CREDIT')
            OR (a.direction = 'CHARGE_TO_SHIPPER' AND NEW.entry_kind = 'ADJUSTMENT_DEBIT'))) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'WALLET_LEDGER_SOURCE_NOT_AVAILABLE: a ledger row needs a valid business source and none exists for it'
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- The bank registry gate: IN as before (an account that can receive); OUT only for a withdrawal that is being processed or reconciled and has no outgoing record yet,
-- and only through an account OF THE SYSTEM (the one the transfer was made from; it does not have to be a receiving account).
CREATE OR REPLACE FUNCTION app.wallet_bank_transactions_gate() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  receiving boolean;
BEGIN
  SELECT a.can_receive INTO receiving FROM app.system_owned_bank_accounts a
    WHERE a.system_account_id = NEW.system_owned_account_id AND a.bank_id = NEW.bank_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_BANK_ACCOUNT_NOT_FOUND' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.direction = 'OUT' THEN
    IF NOT EXISTS (SELECT 1 FROM app.wallet_withdrawals d WHERE d.withdrawal_id = NEW.withdrawal_id AND d.state IN ('PROCESSING', 'RECONCILIATION') AND d.bank_record_id IS NULL) THEN
      RAISE EXCEPTION 'WALLET_BANK_OUT_NOT_AVAILABLE: an outgoing record needs a withdrawal being processed or reconciled' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF receiving IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'WALLET_BANK_ACCOUNT_NOT_RECEIVING' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Commit-time invariants of a withdrawal (see the header)
-- ---------------------------------------------------------------------------------------------------
CREATE FUNCTION app.wallet_withdrawal_assert(target_withdrawal uuid) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  w app.wallet_withdrawals%ROWTYPE;
  hold_status varchar;
  hold_amount bigint;
  hold_wallet uuid;
  hold_purpose varchar;
  hold_source uuid;
  debit_count bigint;
  debit_sum numeric;
  out_direction varchar;
  out_withdrawal uuid;
  out_amount bigint;
  linked uuid;
BEGIN
  SELECT * INTO w FROM app.wallet_withdrawals d WHERE d.withdrawal_id = target_withdrawal;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT h.status, h.amount_vnd, h.wallet_id, h.purpose, h.withdrawal_id INTO hold_status, hold_amount, hold_wallet, hold_purpose, hold_source
    FROM app.wallet_holds h WHERE h.hold_id = w.hold_id;
  IF NOT FOUND OR hold_purpose <> 'WITHDRAWAL' OR hold_source IS DISTINCT FROM w.withdrawal_id OR hold_wallet <> w.wallet_id OR hold_amount <> w.amount_vnd THEN
    RAISE EXCEPTION 'WALLET_WITHDRAWAL_INVARIANT_VIOLATION: a withdrawal needs its own hold of the same wallet and amount' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT count(*), COALESCE(SUM(-l.delta_vnd), 0) INTO debit_count, debit_sum FROM app.wallet_ledger_entries l WHERE l.withdrawal_id = target_withdrawal;
  IF w.state IN ('PENDING', 'PROCESSING', 'RECONCILIATION') AND (hold_status <> 'ACTIVE' OR debit_count <> 0) THEN
    RAISE EXCEPTION 'WALLET_WITHDRAWAL_INVARIANT_VIOLATION: an open withdrawal has an ACTIVE hold and no debit' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF w.state = 'PAID' AND (hold_status <> 'CAPTURED' OR debit_count <> 1 OR debit_sum <> w.amount_vnd) THEN
    RAISE EXCEPTION 'WALLET_WITHDRAWAL_INVARIANT_VIOLATION: a PAID withdrawal has a CAPTURED hold and exactly one debit of its amount' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF w.state = 'CANCELLED' AND (hold_status <> 'RELEASED' OR debit_count <> 0) THEN
    RAISE EXCEPTION 'WALLET_WITHDRAWAL_INVARIANT_VIOLATION: a CANCELLED withdrawal has a RELEASED hold and no debit' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF w.bank_record_id IS NOT NULL THEN
    SELECT b.direction, b.withdrawal_id, b.amount_vnd INTO out_direction, out_withdrawal, out_amount FROM app.wallet_bank_transactions b WHERE b.bank_record_id = w.bank_record_id;
    IF NOT FOUND OR out_direction <> 'OUT' OR out_withdrawal IS DISTINCT FROM w.withdrawal_id THEN
      RAISE EXCEPTION 'WALLET_WITHDRAWAL_INVARIANT_VIOLATION: the outgoing record and the withdrawal must point at each other' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF w.state = 'PAID' AND out_amount <> w.amount_vnd THEN
      RAISE EXCEPTION 'WALLET_WITHDRAWAL_INVARIANT_VIOLATION: a PAID withdrawal needs an outgoing record of exactly its amount' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  SELECT b.bank_record_id INTO linked FROM app.wallet_bank_transactions b WHERE b.withdrawal_id = target_withdrawal;
  IF FOUND AND linked IS DISTINCT FROM w.bank_record_id THEN
    RAISE EXCEPTION 'WALLET_WITHDRAWAL_INVARIANT_VIOLATION: an outgoing record exists that the withdrawal does not reference' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  PERFORM app.wallet_assert_invariants(w.wallet_id);
END;
$$;

CREATE FUNCTION app.wallet_withdrawals_invariants_trigger() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.wallet_withdrawal_assert(NEW.withdrawal_id);
  RETURN NULL;
END;
$$;
CREATE FUNCTION app.wallet_withdrawal_hold_trigger() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.purpose = 'WITHDRAWAL' THEN
    PERFORM app.wallet_withdrawal_assert(NEW.withdrawal_id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE FUNCTION app.wallet_withdrawal_ledger_trigger() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.withdrawal_id IS NOT NULL THEN
    PERFORM app.wallet_withdrawal_assert(NEW.withdrawal_id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE FUNCTION app.wallet_withdrawal_bank_trigger() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.withdrawal_id IS NOT NULL THEN
    PERFORM app.wallet_withdrawal_assert(NEW.withdrawal_id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER wallet_withdrawals_invariants AFTER INSERT OR UPDATE ON app.wallet_withdrawals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.wallet_withdrawals_invariants_trigger();
CREATE CONSTRAINT TRIGGER wallet_holds_withdrawal_assert AFTER INSERT OR UPDATE ON app.wallet_holds
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.wallet_withdrawal_hold_trigger();
CREATE CONSTRAINT TRIGGER wallet_ledger_withdrawal_assert AFTER INSERT ON app.wallet_ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.wallet_withdrawal_ledger_trigger();
CREATE CONSTRAINT TRIGGER wallet_bank_withdrawal_assert AFTER INSERT ON app.wallet_bank_transactions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.wallet_withdrawal_bank_trigger();

-- Down Migration
-- Only for disposable test or experimental databases. Reverse order; no CASCADE and no IF EXISTS: it fails loudly on drift.
-- Safety latch: withdrawal history, the money it moved and the commission policy history are never dropped. Everything is locked first so no row can appear between
-- the check and the DROP; the down migration is refused, with the data untouched, if ANY withdrawal, event, WITHDRAWAL hold, withdrawal debit, outgoing record or a
-- commission policy version other than the seeded one exists.
LOCK TABLE app.wallet_withdrawals, app.wallet_withdrawal_events, app.wallet_holds, app.wallet_ledger_entries, app.wallet_bank_transactions, app.wallet_commission_policies IN ACCESS EXCLUSIVE MODE;
DO $latch$
DECLARE
  rows_found bigint;
BEGIN
  SELECT (SELECT count(*) FROM app.wallet_withdrawals) + (SELECT count(*) FROM app.wallet_withdrawal_events)
       + (SELECT count(*) FROM app.wallet_holds WHERE purpose = 'WITHDRAWAL') + (SELECT count(*) FROM app.wallet_ledger_entries WHERE withdrawal_id IS NOT NULL)
       + (SELECT count(*) FROM app.wallet_bank_transactions WHERE direction = 'OUT') + (SELECT count(*) FROM app.wallet_commission_policies WHERE policy_version > 1)
    INTO rows_found;
  IF rows_found > 0 THEN
    RAISE EXCEPTION 'M04C_DOWN_REFUSED: % withdrawal or commission policy row(s) exist; this history is never dropped', rows_found USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$latch$;
DROP TRIGGER wallet_bank_withdrawal_assert ON app.wallet_bank_transactions;
DROP TRIGGER wallet_ledger_withdrawal_assert ON app.wallet_ledger_entries;
DROP TRIGGER wallet_holds_withdrawal_assert ON app.wallet_holds;
DROP TRIGGER wallet_withdrawals_invariants ON app.wallet_withdrawals;
DROP FUNCTION app.wallet_withdrawal_bank_trigger();
DROP FUNCTION app.wallet_withdrawal_ledger_trigger();
DROP FUNCTION app.wallet_withdrawal_hold_trigger();
DROP FUNCTION app.wallet_withdrawals_invariants_trigger();
DROP FUNCTION app.wallet_withdrawal_assert(uuid);
-- Back to the gates of M07 / B1.
CREATE OR REPLACE FUNCTION app.wallet_bank_transactions_gate() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  receiving boolean;
BEGIN
  IF NEW.direction = 'OUT' THEN
    RAISE EXCEPTION 'WALLET_BANK_OUT_NOT_AVAILABLE: no withdrawal source exists yet' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT a.can_receive INTO receiving FROM app.system_owned_bank_accounts a
    WHERE a.system_account_id = NEW.system_owned_account_id AND a.bank_id = NEW.bank_id FOR SHARE;
  IF receiving IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'WALLET_BANK_ACCOUNT_NOT_RECEIVING' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION app.wallet_ledger_source_gate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entry_kind = 'TOPUP' AND NEW.topup_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM app.wallet_topups t
        WHERE t.topup_id = NEW.topup_id AND t.wallet_id = NEW.wallet_id AND t.actual_amount_vnd = NEW.delta_vnd
     ) THEN
    RETURN NEW;
  END IF;
  IF NEW.entry_kind = 'COMMISSION_DEBIT' AND NEW.commission_assignment_id IS NOT NULL AND EXISTS (
       SELECT 1
         FROM app.wallet_holds h
        WHERE h.commission_assignment_id = NEW.commission_assignment_id
          AND h.wallet_id = NEW.wallet_id
          AND h.purpose = 'COMMISSION'
          AND h.status = 'CAPTURED'
          AND h.amount_vnd = -NEW.delta_vnd) THEN
    RETURN NEW;
  END IF;
  IF NEW.entry_kind IN ('ADJUSTMENT_CREDIT', 'ADJUSTMENT_DEBIT') AND NEW.adjustment_id IS NOT NULL AND EXISTS (
       SELECT 1
         FROM app.wallet_adjustments a
        WHERE a.adjustment_id = NEW.adjustment_id
          AND a.wallet_id = NEW.wallet_id
          AND a.amount_vnd = abs(NEW.delta_vnd)
          AND ((a.direction = 'REFUND_TO_SHIPPER' AND NEW.entry_kind = 'ADJUSTMENT_CREDIT')
            OR (a.direction = 'CHARGE_TO_SHIPPER' AND NEW.entry_kind = 'ADJUSTMENT_DEBIT'))) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'WALLET_LEDGER_SOURCE_NOT_AVAILABLE: a ledger row needs a valid business source and none exists for it'
    USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE OR REPLACE FUNCTION app.wallet_holds_source_gate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.purpose = 'COMMISSION' AND NEW.commission_assignment_id IS NOT NULL AND EXISTS (
       SELECT 1
         FROM app.delivery_assignments a
         JOIN app.driver_wallets w ON w.driver_id = a.driver_id
        WHERE a.assignment_id = NEW.commission_assignment_id
          AND w.wallet_id = NEW.wallet_id
          AND a.commission_vnd = NEW.amount_vnd
          AND a.status = 'ACTIVE') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'WALLET_HOLD_SOURCE_NOT_AVAILABLE: a hold needs a valid business source and none exists yet'
    USING ERRCODE = 'restrict_violation';
END;
$$;
ALTER TABLE app.wallet_withdrawals DROP CONSTRAINT wallet_withdrawals_bank_record_fk;
ALTER TABLE app.wallet_bank_transactions DROP CONSTRAINT wallet_bank_transactions_withdrawal_fk;
ALTER TABLE app.wallet_ledger_entries DROP CONSTRAINT wallet_ledger_entries_withdrawal_fk;
ALTER TABLE app.wallet_ledger_entries DROP CONSTRAINT wallet_ledger_entries_withdrawal_uq;
ALTER TABLE app.wallet_ledger_entries DROP CONSTRAINT wallet_ledger_entries_withdrawal_source_ck;
ALTER TABLE app.wallet_ledger_entries DROP COLUMN withdrawal_id;
ALTER TABLE app.wallet_holds DROP CONSTRAINT wallet_holds_withdrawal_fk;
ALTER TABLE app.wallet_withdrawals DROP CONSTRAINT wallet_withdrawals_hold_fk;
DROP TRIGGER wallet_withdrawal_events_append_only ON app.wallet_withdrawal_events;
DROP TABLE app.wallet_withdrawal_events;
DROP TRIGGER wallet_withdrawals_no_delete ON app.wallet_withdrawals;
DROP TRIGGER wallet_withdrawals_guard ON app.wallet_withdrawals;
DROP FUNCTION app.wallet_withdrawals_guard();
DROP TABLE app.wallet_withdrawals;
DROP TRIGGER wallet_commission_policies_append_only ON app.wallet_commission_policies;
DROP TRIGGER wallet_commission_policies_guard ON app.wallet_commission_policies;
DROP FUNCTION app.wallet_commission_policies_guard();
DROP TABLE app.wallet_commission_policies;
DROP FUNCTION app.wallet_withdrawal_reject_mutation();
