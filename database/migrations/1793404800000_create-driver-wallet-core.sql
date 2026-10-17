-- Up Migration
-- M04-A1: Shipper wallet core and money ledger (docs/current/ADR-004-driver-wallet-consistency.md, sections 2-4).
--
-- Scope of THIS migration: one wallet per driver (always created at zero), its balance B / held amount H / version, and the append-only
-- ledger table. NOT in scope: top-ups, withdrawals, adjustments, commission, holds (M04-A2 / M04-B / M04-C / M07).
--
-- Safe on a database that has data: it only ADDS two tables, one function set and their triggers. app.drivers and every other table
-- keep all columns, constraints and rows; nothing is dropped, truncated or rewritten; no CASCADE. No wallet is created here (no
-- balance is invented): wallets are created one by one, at zero, by the M04 participant under the driver lock.
--
-- HOW LEDGER ROWS BECOME POSSIBLE (step plan, ADR-004 4.2): every ledger row needs a valid business source (a top-up, a withdrawal
-- debit, a commission assignment or an adjustment decision). Those source tables belong to later packages, so in this migration the
-- ledger has NO source column and NO row can be inserted: the trigger wallet_ledger_a_source_gate refuses every INSERT (fail closed,
-- code P0001, message WALLET_LEDGER_SOURCE_NOT_AVAILABLE). A later migration that creates a source table must, in ONE transaction:
-- (1) assert that app.wallet_ledger_entries is still empty, (2) add the source column(s) with a real FOREIGN KEY and the CHECK that
-- exactly one source matching entry_kind is present, plus a UNIQUE per source, (3) replace app.wallet_ledger_source_gate() so it
-- accepts only a row whose source row exists for the same wallet and amount. There is never a moment where a ledger row can be
-- written without a source, and no polymorphic id without a foreign key is used.
--
-- The same rule holds for the held amount: there is no hold table yet, so H must be 0 (wallet_assert_invariants). M04-A2 replaces the
-- check by H = SUM(ACTIVE holds).

-- ---------------------------------------------------------------------------------------------------
-- app.driver_wallets
-- ---------------------------------------------------------------------------------------------------
-- A = balance_vnd - held_vnd is computed, never stored. VND whole numbers (bigint), bounded by the largest integer a JSON number
-- carries exactly (9007199254740991), which is a technical limit, not a product quota.
CREATE TABLE app.driver_wallets (
  wallet_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  balance_vnd bigint NOT NULL DEFAULT 0,
  held_vnd bigint NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT driver_wallets_pkey PRIMARY KEY (wallet_id),
  -- One wallet per driver: the database decides, whatever the application does under concurrency.
  CONSTRAINT driver_wallets_driver_uq UNIQUE (driver_id),
  CONSTRAINT driver_wallets_driver_fk FOREIGN KEY (driver_id) REFERENCES app.drivers (driver_id) ON DELETE RESTRICT,
  CONSTRAINT driver_wallets_balance_ck CHECK (balance_vnd >= 0 AND balance_vnd <= 9007199254740991),
  CONSTRAINT driver_wallets_held_ck CHECK (held_vnd >= 0 AND held_vnd <= balance_vnd),
  CONSTRAINT driver_wallets_version_ck CHECK (version >= 1),
  CONSTRAINT driver_wallets_time_order_ck CHECK (updated_at >= created_at)
);

-- ---------------------------------------------------------------------------------------------------
-- app.wallet_ledger_entries (append-only)
-- ---------------------------------------------------------------------------------------------------
-- delta_vnd is signed and never 0; balance_after_vnd is the balance right after this row. sequence_no is 1, 2, 3 ... per wallet without
-- gaps (wallet_ledger_chain). The kinds are the ledger kinds of ADR-004 4.1: reserve and release are NOT ledger rows (they only move H).
CREATE TABLE app.wallet_ledger_entries (
  entry_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  sequence_no bigint NOT NULL,
  entry_kind varchar(24) NOT NULL,
  delta_vnd bigint NOT NULL,
  balance_after_vnd bigint NOT NULL,
  created_at timestamptz NOT NULL,

  CONSTRAINT wallet_ledger_entries_pkey PRIMARY KEY (entry_id),
  CONSTRAINT wallet_ledger_entries_wallet_fk FOREIGN KEY (wallet_id) REFERENCES app.driver_wallets (wallet_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_ledger_entries_sequence_uq UNIQUE (wallet_id, sequence_no),
  CONSTRAINT wallet_ledger_entries_sequence_ck CHECK (sequence_no >= 1),
  CONSTRAINT wallet_ledger_entries_kind_ck CHECK (entry_kind IN ('TOPUP', 'WITHDRAWAL_DEBIT', 'COMMISSION_DEBIT', 'ADJUSTMENT_CREDIT', 'ADJUSTMENT_DEBIT')),
  CONSTRAINT wallet_ledger_entries_delta_ck CHECK (
    delta_vnd <> 0 AND delta_vnd BETWEEN -9007199254740991 AND 9007199254740991
    AND ((entry_kind IN ('TOPUP', 'ADJUSTMENT_CREDIT') AND delta_vnd > 0)
      OR (entry_kind IN ('WITHDRAWAL_DEBIT', 'COMMISSION_DEBIT', 'ADJUSTMENT_DEBIT') AND delta_vnd < 0))
  ),
  CONSTRAINT wallet_ledger_entries_balance_after_ck CHECK (balance_after_vnd >= 0 AND balance_after_vnd <= 9007199254740991)
);

-- ---------------------------------------------------------------------------------------------------
-- Wallet rules enforced by the database itself
-- ---------------------------------------------------------------------------------------------------
-- A wallet is born at zero (no opening money without a ledger row) and is never deleted.
CREATE FUNCTION app.driver_wallets_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.balance_vnd <> 0 OR NEW.held_vnd <> 0 OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'WALLET_MUST_START_AT_ZERO' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: identity is immutable and every update advances the version by exactly one (the optimistic-concurrency control).
  IF NEW.wallet_id <> OLD.wallet_id OR NEW.driver_id <> OLD.driver_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'WALLET_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'WALLET_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER driver_wallets_guard BEFORE INSERT OR UPDATE ON app.driver_wallets
  FOR EACH ROW EXECUTE FUNCTION app.driver_wallets_guard();

CREATE FUNCTION app.driver_wallets_reject_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.driver_wallets is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER driver_wallets_no_delete BEFORE DELETE OR TRUNCATE ON app.driver_wallets
  FOR EACH STATEMENT EXECUTE FUNCTION app.driver_wallets_reject_delete();

-- ---------------------------------------------------------------------------------------------------
-- Ledger rules enforced by the database itself
-- ---------------------------------------------------------------------------------------------------
-- Append-only: no UPDATE, DELETE or TRUNCATE (statement-level, so it fires even when no row matches).
CREATE FUNCTION app.wallet_ledger_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.wallet_ledger_entries is append-only (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER wallet_ledger_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON app.wallet_ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION app.wallet_ledger_reject_mutation();

-- The source gate (see the step plan at the top). Fires FIRST (trigger names run in alphabetical order). Until a package provides the
-- source tables, no ledger row may exist.
CREATE FUNCTION app.wallet_ledger_source_gate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WALLET_LEDGER_SOURCE_NOT_AVAILABLE: a ledger row needs a valid business source and none exists yet'
    USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER wallet_ledger_a_source_gate BEFORE INSERT ON app.wallet_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION app.wallet_ledger_source_gate();

-- The chain: under the wallet lock (taken here too, so even a writer that forgot it is serialised), a new row continues the previous one:
-- sequence_no = last + 1, balance_after = previous balance_after + delta, and the wallet balance still equals the previous balance_after.
CREATE FUNCTION app.wallet_ledger_chain() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  last_sequence bigint;
  last_balance bigint;
BEGIN
  PERFORM 1 FROM app.driver_wallets WHERE wallet_id = NEW.wallet_id FOR UPDATE;
  SELECT l.sequence_no, l.balance_after_vnd INTO last_sequence, last_balance
    FROM app.wallet_ledger_entries l WHERE l.wallet_id = NEW.wallet_id ORDER BY l.sequence_no DESC LIMIT 1;
  IF NOT FOUND THEN
    last_sequence := 0;
    last_balance := 0;
  END IF;
  IF NEW.sequence_no <> last_sequence + 1 OR NEW.balance_after_vnd <> last_balance + NEW.delta_vnd THEN
    RAISE EXCEPTION 'WALLET_LEDGER_CHAIN_BROKEN' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wallet_ledger_chain BEFORE INSERT ON app.wallet_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION app.wallet_ledger_chain();

-- ---------------------------------------------------------------------------------------------------
-- The wallet invariant, checked at COMMIT for every wallet touched (ADR-004 4.2, deferred constraint triggers)
-- ---------------------------------------------------------------------------------------------------
--   * balance_vnd = SUM(ledger.delta_vnd)   (and = balance_after of the last row when there is one)
--   * held_vnd = 0 for now (no hold exists; M04-A2 replaces this by H = SUM(ACTIVE holds))
-- Any mismatch rolls the WHOLE transaction back with WALLET_INVARIANT_VIOLATION; nothing is repaired automatically. The balance is never
-- used as the truth by itself: the ledger sum is recomputed here.
CREATE FUNCTION app.wallet_assert_invariants(target_wallet uuid) RETURNS void
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

CREATE FUNCTION app.wallet_invariants_trigger() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.wallet_assert_invariants(NEW.wallet_id);
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER driver_wallets_invariants AFTER INSERT OR UPDATE ON app.driver_wallets
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.wallet_invariants_trigger();
CREATE CONSTRAINT TRIGGER wallet_ledger_invariants AFTER INSERT ON app.wallet_ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.wallet_invariants_trigger();

-- Down Migration
-- Only for disposable test or experimental databases. Reverse order; no CASCADE and no IF EXISTS: it fails loudly on drift.
-- Safety latch: money history is never dropped. Both tables are locked ACCESS EXCLUSIVE first, so no wallet or ledger row can appear
-- between the check and the DROP, and the whole down migration is refused, with the data untouched, if either table holds any row.
LOCK TABLE app.driver_wallets, app.wallet_ledger_entries IN ACCESS EXCLUSIVE MODE;
DO $latch$
DECLARE
  wallet_rows bigint;
  ledger_rows bigint;
BEGIN
  SELECT count(*) INTO wallet_rows FROM app.driver_wallets;
  SELECT count(*) INTO ledger_rows FROM app.wallet_ledger_entries;
  IF wallet_rows > 0 OR ledger_rows > 0 THEN
    RAISE EXCEPTION 'WALLET_DOWN_MIGRATION_REFUSED: % wallet row(s) and % ledger row(s) exist; wallet data is never dropped', wallet_rows, ledger_rows
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$latch$;
DROP TRIGGER wallet_ledger_invariants ON app.wallet_ledger_entries;
DROP TRIGGER driver_wallets_invariants ON app.driver_wallets;
DROP FUNCTION app.wallet_invariants_trigger();
DROP FUNCTION app.wallet_assert_invariants(uuid);
DROP TRIGGER wallet_ledger_chain ON app.wallet_ledger_entries;
DROP FUNCTION app.wallet_ledger_chain();
DROP TRIGGER wallet_ledger_a_source_gate ON app.wallet_ledger_entries;
DROP FUNCTION app.wallet_ledger_source_gate();
DROP TRIGGER wallet_ledger_append_only ON app.wallet_ledger_entries;
DROP FUNCTION app.wallet_ledger_reject_mutation();
DROP TABLE app.wallet_ledger_entries;
DROP TRIGGER driver_wallets_no_delete ON app.driver_wallets;
DROP FUNCTION app.driver_wallets_reject_delete();
DROP TRIGGER driver_wallets_guard ON app.driver_wallets;
DROP FUNCTION app.driver_wallets_guard();
DROP TABLE app.driver_wallets;
