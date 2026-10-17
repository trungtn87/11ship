-- Up Migration
-- M04-A2.1: the Shipper held-money core (docs/tasks/M04-A2-hold-core-20261017.md, ADR-004 sections 2-4).
--
-- Scope of THIS migration: the table app.wallet_holds and the database rules around it. A hold is money of a wallet set aside for ONE
-- business source (a commission assignment of M07, or a withdrawal of M04-C). NOT in scope (M04-A2.2): reserving, releasing or
-- capturing a hold. This migration builds NO source table and invents no source: it only prepares the place a hold will live.
--
-- Safe on a database that has data (A1 wallets, M03): it only ADDS one table, its functions and triggers, and REPLACES one function
-- (app.wallet_assert_invariants, same signature). app.driver_wallets, app.wallet_ledger_entries and every M03 table keep every column,
-- constraint and row; nothing is dropped, truncated or rewritten; no CASCADE.
--
-- HOW HOLD ROWS BECOME POSSIBLE (step plan). Until the source tables exist, no hold may be written: the trigger
-- wallet_holds_a_source_gate refuses EVERY insert (fail closed, message WALLET_HOLD_SOURCE_NOT_AVAILABLE). The two source columns are
-- typed (commission_assignment_id, withdrawal_id) and carry NO foreign key yet, because the tables they will reference (M07
-- delivery assignments, M04-C wallet withdrawals) do not exist; there is no polymorphic id. The migration that creates such a source
-- table must, in ONE transaction: (1) assert app.wallet_holds is still empty, (2) add the FOREIGN KEY of that column (DEFERRABLE
-- INITIALLY DEFERRED if the two tables reference each other), (3) replace app.wallet_holds_source_gate() so that it accepts only a row
-- whose source row exists for the same driver (the wallet's own driver) and the same amount, and whose purpose matches the source
-- kind. There is never a moment where a hold can be written without a valid source.
--
-- The held amount stays a number kept consistent by the database: wallet_assert_invariants now requires
-- held_vnd = SUM(amount_vnd of the ACTIVE holds), checked at COMMIT for every wallet or hold touched.

-- ---------------------------------------------------------------------------------------------------
-- app.wallet_holds
-- ---------------------------------------------------------------------------------------------------
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
  -- A hold is a positive amount, bounded by the same technical limit as a balance (not a product quota).
  CONSTRAINT wallet_holds_amount_ck CHECK (amount_vnd > 0 AND amount_vnd <= 9007199254740991),
  CONSTRAINT wallet_holds_status_ck CHECK (status IN ('ACTIVE', 'CAPTURED', 'RELEASED')),
  -- Exactly the source column that belongs to the purpose, and no other.
  CONSTRAINT wallet_holds_source_ck CHECK (
    (purpose = 'COMMISSION' AND commission_assignment_id IS NOT NULL AND withdrawal_id IS NULL)
    OR (purpose = 'WITHDRAWAL' AND withdrawal_id IS NOT NULL AND commission_assignment_id IS NULL)
  ),
  CONSTRAINT wallet_holds_version_ck CHECK (version >= 1),
  CONSTRAINT wallet_holds_time_order_ck CHECK (updated_at >= created_at),
  -- ACTIVE has not been resolved; CAPTURED / RELEASED have, and not before the hold was made.
  CONSTRAINT wallet_holds_resolved_ck CHECK (
    (status = 'ACTIVE' AND resolved_at IS NULL) OR (status <> 'ACTIVE' AND resolved_at IS NOT NULL AND resolved_at >= created_at)
  ),
  -- One hold per source, whatever its status: a source can never hold twice.
  CONSTRAINT wallet_holds_commission_assignment_uq UNIQUE (commission_assignment_id),
  CONSTRAINT wallet_holds_withdrawal_uq UNIQUE (withdrawal_id)
);
CREATE INDEX wallet_holds_wallet_status_idx ON app.wallet_holds (wallet_id, status);

-- ---------------------------------------------------------------------------------------------------
-- Hold rules enforced by the database itself
-- ---------------------------------------------------------------------------------------------------
-- The source gate (see the step plan at the top). Trigger names run in alphabetical order, so it fires first.
CREATE FUNCTION app.wallet_holds_source_gate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WALLET_HOLD_SOURCE_NOT_AVAILABLE: a hold needs a valid business source and none exists yet'
    USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER wallet_holds_a_source_gate BEFORE INSERT ON app.wallet_holds
  FOR EACH ROW EXECUTE FUNCTION app.wallet_holds_source_gate();

-- Identity, purpose, source, amount and creation time never change. The only transitions are ACTIVE -> CAPTURED and ACTIVE -> RELEASED
-- (a terminal hold never moves again), each advancing the version by exactly one.
CREATE FUNCTION app.wallet_holds_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.hold_id <> OLD.hold_id OR NEW.wallet_id <> OLD.wallet_id OR NEW.purpose <> OLD.purpose OR NEW.amount_vnd <> OLD.amount_vnd
     OR NEW.created_at <> OLD.created_at
     OR NEW.commission_assignment_id IS DISTINCT FROM OLD.commission_assignment_id
     OR NEW.withdrawal_id IS DISTINCT FROM OLD.withdrawal_id THEN
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
CREATE TRIGGER wallet_holds_guard BEFORE UPDATE ON app.wallet_holds
  FOR EACH ROW EXECUTE FUNCTION app.wallet_holds_guard();

-- Hold history is never deleted (statement-level, so it fires even when no row matches).
CREATE FUNCTION app.wallet_holds_reject_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.wallet_holds is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER wallet_holds_no_delete BEFORE DELETE OR TRUNCATE ON app.wallet_holds
  FOR EACH STATEMENT EXECUTE FUNCTION app.wallet_holds_reject_delete();

-- ---------------------------------------------------------------------------------------------------
-- The wallet invariant, now with the held amount (replaces the A1 body; same name, same signature, so the A1 triggers keep working)
-- ---------------------------------------------------------------------------------------------------
--   * balance_vnd = SUM(ledger.delta_vnd) = balance_after of the last ledger row   (unchanged from A1)
--   * held_vnd    = SUM(amount_vnd of the ACTIVE holds)                            (A1 had: held_vnd = 0)
--   * held_vnd <= balance_vnd is the CHECK of the wallet table; a hold never writes the ledger (reserve and release only move H).
-- The same function is the deferred constraint trigger of the wallet, the ledger AND now the hold table, so a change to any of the
-- three is checked at COMMIT and a mismatch of one coin rolls the whole transaction back.
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
  IF wallet_held::numeric <> active_sum THEN
    RAISE EXCEPTION 'WALLET_INVARIANT_VIOLATION: held does not equal the active holds' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END;
$$;

CREATE CONSTRAINT TRIGGER wallet_holds_invariants AFTER INSERT OR UPDATE ON app.wallet_holds
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.wallet_invariants_trigger();

-- Down Migration
-- Only for disposable test or experimental databases. Reverse order; no CASCADE and no IF EXISTS: it fails loudly on drift.
-- Safety latch: hold history is never dropped. The hold table and the wallet table are locked ACCESS EXCLUSIVE first, so no hold can be
-- written between the check and the DROP. The down migration is refused, with the data untouched, if wallet_holds has ANY row (a
-- RELEASED or CAPTURED one too) or if any wallet still shows a held amount (then the A1 rule held = 0 would not hold).
LOCK TABLE app.wallet_holds, app.driver_wallets IN ACCESS EXCLUSIVE MODE;
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
-- Back to the A1 invariant (held must be 0), byte for byte.
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
DROP FUNCTION app.wallet_holds_source_gate();
DROP TABLE app.wallet_holds;
