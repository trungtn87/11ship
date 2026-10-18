-- Up Migration
-- M04-B2.2b: opens the ledger source gate of M04-A1 for ONE kind, TOPUP, and only for a row whose topup source exists (docs/tasks/M04-B2-2b-admin-topup-posting-20261018.md).
--
-- This is the migration B1 announced: app.wallet_ledger_source_gate() is replaced so that it accepts exactly a ledger row of kind TOPUP whose
-- topup_id points to an EXISTING app.wallet_topups row of the same wallet and the same amount (delta = actual amount). EVERY other row is refused
-- exactly as before (same error, same code): TOPUP without a source or with a wrong wallet / amount, and every other kind (COMMISSION_DEBIT,
-- WITHDRAWAL_DEBIT, ADJUSTMENT_CREDIT, ADJUSTMENT_DEBIT) whatever it carries. Nothing else changes: the trigger, the chain, the append-only rule,
-- the typed foreign key (topup_id, wallet_id, delta_vnd) -> wallet_topups, UNIQUE(topup_id) and the commit-time invariants of A1 / A2.1 / B1 stay as they are, so
-- a credit can still only COMMIT together with its topup, its bank record (both directions), the wallet balance, and a CONFIRMED request.
--
-- The privileges the posting needs (INSERT into the bank registry, the topups and the ledger; UPDATE of the wallet and of the receiving account flag) are
-- granted in ops/selfhosted/02-runtime-grants.sql, not here. No data is touched; nothing is dropped.
--
-- A bank record can still only be registered against an account whose can_receive is true at that moment (the B1 gate is not changed): money that arrived
-- before an account was switched off is recorded by switching it on again for the time of the recording, each switch versioned and audited.

CREATE OR REPLACE FUNCTION app.wallet_ledger_source_gate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entry_kind = 'TOPUP' AND NEW.topup_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM app.wallet_topups t
        WHERE t.topup_id = NEW.topup_id AND t.wallet_id = NEW.wallet_id AND t.actual_amount_vnd = NEW.delta_vnd
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'WALLET_LEDGER_SOURCE_NOT_AVAILABLE: a ledger row needs a valid business source and none exists for it'
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- Down Migration
-- Only for disposable test or experimental databases. Restores the A1 gate (refuses every ledger INSERT).
-- Safety latch: once money was posted the gate is never closed again behind it. The ledger and the topup tables are locked ACCESS EXCLUSIVE first, so no credit
-- can be posted between the check and the restore; ANY ledger row, topup or bank record refuses the down migration and loses nothing.
LOCK TABLE app.wallet_ledger_entries, app.wallet_topups, app.wallet_bank_transactions IN ACCESS EXCLUSIVE MODE;
DO $latch$
DECLARE
  ledger_rows bigint;
  topup_rows bigint;
  bank_rows bigint;
BEGIN
  SELECT count(*) INTO ledger_rows FROM app.wallet_ledger_entries;
  SELECT count(*) INTO topup_rows FROM app.wallet_topups;
  SELECT count(*) INTO bank_rows FROM app.wallet_bank_transactions;
  IF ledger_rows > 0 OR topup_rows > 0 OR bank_rows > 0 THEN
    RAISE EXCEPTION 'WALLET_TOPUP_POSTING_DOWN_REFUSED: % ledger row(s), % topup(s) and % bank record(s) exist; posted money is never rolled back', ledger_rows, topup_rows, bank_rows
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$latch$;
CREATE OR REPLACE FUNCTION app.wallet_ledger_source_gate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WALLET_LEDGER_SOURCE_NOT_AVAILABLE: a ledger row needs a valid business source and none exists yet'
    USING ERRCODE = 'restrict_violation';
END;
$$;
