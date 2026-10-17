-- Up Migration
-- M04-A2.1: Shipper wallet holds, the database core (docs/tasks/M04-A2-hold-core-20261017.md, ADR-004 sections 2-4).
--
-- Scope of THIS migration: the hold table, its immutability / state-machine rules, the extended wallet invariant (held_vnd = SUM of
-- ACTIVE holds) and its commit-time check. NOT in scope: reserve / release / capture commands, any write grant, any endpoint (M04-A2.2).
--
-- Safe on a database that has data: it only ADDS one table, three functions and their triggers and REPLACES one A1 function body. No wallet,
-- ledger or M03 row is read-modified or rewritten; nothing is dropped; no CASCADE. The A1 migration is not edited.
--
-- HOW HOLD ROWS BECOME POSSIBLE (step plan). Every hold needs a valid business source: COMMISSION -> a delivery assignment (M07),
-- WITHDRAWAL -> a withdrawal request (M04-C). Neither table exists yet, so the two source columns below are typed uuid columns WITHOUT a
-- foreign key (a FK to a missing table is impossible, and a polymorphic source id is not allowed) and the trigger
-- wallet_holds_a_source_gate refuses EVERY INSERT (fail closed, message WALLET_HOLD_SOURCE_NOT_AVAILABLE). The migration that creates
-- app.delivery_assignments (M07) or app.wallet_withdrawals (M04-C) must, in the SAME atomic migration: (1) assert wallet_holds is still
-- empty, (2) add the real FOREIGN KEY on the matching typed column (DEFERRABLE INITIALLY DEFERRED if the references form a cycle), (3)
-- replace app.wallet_hold_source_gate() so that it accepts only a row whose source exists for the same driver/wallet and amount, for that
-- purpose only. There is never a moment where a hold can be written without a source.

CREATE TABLE app.wallet_holds (
  hold_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  purpose varchar(16) NOT NULL,
  amount_vnd bigint NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE',
  commission_assignment_id uuid,
  withdrawal_id uuid,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  resolved_at timestamptz,

  CONSTRAINT wallet_holds_pkey PRIMARY KEY (hold_id),
  CONSTRAINT wallet_holds_wallet_fk FOREIGN KEY (wallet_id) REFERENCES app.driver_wallets (wallet_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_holds_purpose_ck CHECK (purpose IN ('COMMISSION', 'WITHDRAWAL')),
  -- Same technical cap as the wallet (the biggest integer a JSON number carries exactly); a hold is always positive.
  CONSTRAINT wallet_holds_amount_ck CHECK (amount_vnd > 0 AND amount_vnd <= 9007199254740991),
  CONSTRAINT wallet_holds_status_ck CHECK (status IN ('ACTIVE', 'CAPTURED', 'RELEASED')),
  -- Exactly the source column of the purpose, never both, never neither.
  CONSTRAINT wallet_holds_source_ck CHECK (
    (purpose = 'COMMISSION' AND commission_assignment_id IS NOT NULL AND withdrawal_id IS NULL)
    OR (purpose = 'WITHDRAWAL' AND withdrawal_id IS NOT NULL AND commission_assignment_id IS NULL)
  ),
  CONSTRAINT wallet_holds_resolved_ck CHECK ((status = 'ACTIVE') = (resolved_at IS NULL)),
  CONSTRAINT wallet_holds_version_ck CHECK (version >= 1),
  CONSTRAINT wallet_holds_time_order_ck CHECK (updated_at >= created_at AND (resolved_at IS NULL OR resolved_at >= created_at)),
  -- One hold per source and purpose: the database decides, whatever the application does under concurrency.
  CONSTRAINT wallet_holds_commission_uq UNIQUE (commission_assignment_id),
  CONSTRAINT wallet_holds_withdrawal_uq UNIQUE (withdrawal_id)
);
CREATE INDEX wallet_holds_wallet_status_idx ON app.wallet_holds (wallet_id, status);

-- The source gate (see the step plan). Fires FIRST (trigger names run in alphabetical order). Until a package provides the source tables
-- no hold may exist.
CREATE FUNCTION app.wallet_hold_source_gate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WALLET_HOLD_SOURCE_NOT_AVAILABLE: a hold needs a valid business source and none exists yet'
    USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER wallet_holds_a_source_gate BEFORE INSERT ON app.wallet_holds
  FOR EACH ROW EXECUTE FUNCTION app.wallet_hold_source_gate();

-- Row rules. Both paths take the wallet row lock first (as the ledger chain does), so even a writer that forgot it is serialised.
-- INSERT must be ACTIVE and unresolved at version 1. UPDATE: identity, wallet, purpose, source and amount are immutable; the only
-- transitions are ACTIVE -> CAPTURED and ACTIVE -> RELEASED (a terminal hold never changes again), the version advances by exactly one.
CREATE FUNCTION app.wallet_holds_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM app.driver_wallets WHERE wallet_id = NEW.wallet_id FOR UPDATE;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'ACTIVE' OR NEW.resolved_at IS NOT NULL OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'WALLET_HOLD_MUST_START_ACTIVE' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.hold_id <> OLD.hold_id OR NEW.wallet_id <> OLD.wallet_id OR NEW.purpose <> OLD.purpose OR NEW.amount_vnd <> OLD.amount_vnd
     OR NEW.commission_assignment_id IS DISTINCT FROM OLD.commission_assignment_id OR NEW.withdrawal_id IS DISTINCT FROM OLD.withdrawal_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'WALLET_HOLD_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'ACTIVE' OR NEW.status NOT IN ('CAPTURED', 'RELEASED') THEN
    RAISE EXCEPTION 'WALLET_HOLD_TRANSITION_REFUSED: % -> %', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'WALLET_HOLD_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wallet_holds_guard BEFORE INSERT OR UPDATE ON app.wallet_holds
  FOR EACH ROW EXECUTE FUNCTION app.wallet_holds_guard();

-- A hold is never deleted (statement level, so it fires even when no row matches).
CREATE FUNCTION app.wallet_holds_reject_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.wallet_holds is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER wallet_holds_no_delete BEFORE DELETE OR TRUNCATE ON app.wallet_holds
  FOR EACH STATEMENT EXECUTE FUNCTION app.wallet_holds_reject_delete();

-- The wallet invariant, now with holds (replaces the A1 body; same signature, so the A1 constraint triggers keep calling it):
--   * balance_vnd = SUM(ledger.delta_vnd) = balance_after of the last ledger row
--   * held_vnd    = SUM(amount_vnd of the ACTIVE holds)   (and therefore held <= balance by the wallet CHECK)
-- Checked at COMMIT for every wallet touched, by the A1 triggers on the wallet and the ledger and by the new one on the holds. Any
-- mismatch rolls the WHOLE transaction back; nothing is repaired automatically. A hold never writes a ledger row (reserve/release only
-- move H), so the first rule is unaffected by holds.
CREATE OR REPLACE FUNCTION app.wallet_assert_invariants(target_wallet uuid) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  wallet_balance bigint;
  wallet_held bigint;
  ledger_sum numeric;
  last_balance bigint;
  active_sum numeric;
BEGIN
  SELECT w.balance_vnd, w.held_vnd INTO wallet_balance, wallet_held FROM app.driver_wallets w WHERE w.wallet_id = target_wallet;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT COALESCE(SUM(l.delta_vnd), 0) INTO ledger_sum FROM app.wallet_ledger_entries l WHERE l.wallet_id = target_wallet;
  SELECT l.balance_after_vnd INTO last_balance FROM app.wallet_ledger_entries l WHERE l.wallet_id = target_wallet ORDER BY l.sequence_no DESC LIMIT 1;
  IF NOT FOUND THEN
    last_balance := 0;
  END IF;
  IF wallet_balance::numeric <> ledger_sum OR wallet_balance <> last_balance THEN
    RAISE EXCEPTION 'WALLET_INVARIANT_VIOLATION: balance does not equal the ledger' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT COALESCE(SUM(h.amount_vnd), 0) INTO active_sum FROM app.wallet_holds h WHERE h.wallet_id = target_wallet AND h.status = 'ACTIVE';
  IF wallet_held::numeric <> active_sum OR wallet_held > wallet_balance THEN
    RAISE EXCEPTION 'WALLET_INVARIANT_VIOLATION: held does not equal the active holds' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END;
$$;

CREATE CONSTRAINT TRIGGER wallet_holds_invariants AFTER INSERT OR UPDATE ON app.wallet_holds
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.wallet_invariants_trigger();

-- Down Migration
-- Only for disposable test or experimental databases. Reverse order; no CASCADE and no IF EXISTS: it fails loudly on drift.
-- Safety latch: hold history is never dropped. The tables are locked ACCESS EXCLUSIVE first (one statement, one lock order), so no hold
-- or wallet change can appear between the checks and the DROP. Refused, with the data untouched, if wallet_holds holds ANY row (also a
-- RELEASED or CAPTURED one) or if a wallet shows a held amount.
LOCK TABLE app.driver_wallets, app.wallet_ledger_entries, app.wallet_holds IN ACCESS EXCLUSIVE MODE;
DO $latch$
DECLARE
  hold_rows bigint;
  held_wallets bigint;
BEGIN
  SELECT count(*) INTO hold_rows FROM app.wallet_holds;
  SELECT count(*) INTO held_wallets FROM app.driver_wallets WHERE held_vnd <> 0;
  IF hold_rows > 0 OR held_wallets > 0 THEN
    RAISE EXCEPTION 'WALLET_HOLD_DOWN_REFUSED: % hold row(s) and % wallet(s) with a held amount exist; hold data is never dropped', hold_rows, held_wallets
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$latch$;
DROP TRIGGER wallet_holds_invariants ON app.wallet_holds;
-- Restore the A1 invariant (held must be 0) before the table that justified the new one goes away.
CREATE OR REPLACE FUNCTION app.wallet_assert_invariants(target_wallet uuid) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  wallet_balance bigint;
  wallet_held bigint;
  ledger_sum numeric;
  last_balance bigint;
BEGIN
  SELECT w.balance_vnd, w.held_vnd INTO wallet_balance, wallet_held FROM app.driver_wallets w WHERE w.wallet_id = target_wallet;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT COALESCE(SUM(l.delta_vnd), 0) INTO ledger_sum FROM app.wallet_ledger_entries l WHERE l.wallet_id = target_wallet;
  SELECT l.balance_after_vnd INTO last_balance FROM app.wallet_ledger_entries l WHERE l.wallet_id = target_wallet ORDER BY l.sequence_no DESC LIMIT 1;
  IF NOT FOUND THEN
    last_balance := 0;
  END IF;
  IF wallet_balance::numeric <> ledger_sum OR wallet_balance <> last_balance THEN
    RAISE EXCEPTION 'WALLET_INVARIANT_VIOLATION: balance does not equal the ledger' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF wallet_held <> 0 THEN
    RAISE EXCEPTION 'WALLET_INVARIANT_VIOLATION: no hold source exists yet, held must be 0' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END;
$$;
DROP TRIGGER wallet_holds_no_delete ON app.wallet_holds;
DROP FUNCTION app.wallet_holds_reject_delete();
DROP TRIGGER wallet_holds_guard ON app.wallet_holds;
DROP FUNCTION app.wallet_holds_guard();
DROP TRIGGER wallet_holds_a_source_gate ON app.wallet_holds;
DROP FUNCTION app.wallet_hold_source_gate();
DROP TABLE app.wallet_holds;
