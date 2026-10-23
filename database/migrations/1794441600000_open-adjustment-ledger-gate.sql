-- Up Migration
-- M04: the adjustment posting (the money side of an outcome adjustment that M11 decides). A refund or an extra charge of a commission is an ADJUSTMENT_CREDIT /
-- ADJUSTMENT_DEBIT ledger row and has its OWN source: one app.wallet_adjustments row per decision (UNIQUE source), with the wallet, the direction and the
-- amount. The ledger gate opens for exactly that: a row whose adjustment exists for the same wallet, the same amount and the matching direction. Everything
-- else stays refused. One adjustment has exactly one ledger row (checked at COMMIT, so a repeat can never take or give the money twice), the ledger stays
-- append-only, and the wallet constraints still hold: the balance never goes below zero and never below the money held for a delivery (held <= balance).
-- Nothing here is called by a person: it is the participant the Administration's action reaches through the wallet package.

CREATE TABLE app.wallet_adjustments (
  adjustment_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  -- What decided it. Today only an M11 complaint; the pair is unique, so a retry or a second click can never post twice.
  source_type varchar(16) NOT NULL,
  source_id uuid NOT NULL,
  direction varchar(20) NOT NULL,
  amount_vnd bigint NOT NULL,
  posted_by uuid NOT NULL,
  created_at timestamptz NOT NULL,

  CONSTRAINT wallet_adjustments_pkey PRIMARY KEY (adjustment_id),
  CONSTRAINT wallet_adjustments_source_uq UNIQUE (source_type, source_id),
  CONSTRAINT wallet_adjustments_wallet_fk FOREIGN KEY (wallet_id) REFERENCES app.driver_wallets (wallet_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_adjustments_actor_fk FOREIGN KEY (posted_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_adjustments_source_ck CHECK (source_type IN ('COMPLAINT')),
  CONSTRAINT wallet_adjustments_direction_ck CHECK (direction IN ('REFUND_TO_SHIPPER', 'CHARGE_TO_SHIPPER')),
  CONSTRAINT wallet_adjustments_amount_ck CHECK (amount_vnd BETWEEN 1 AND 9007199254740991)
);

CREATE FUNCTION app.wallet_adjustments_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.wallet_adjustments is append-only (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER wallet_adjustments_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON app.wallet_adjustments
  FOR EACH STATEMENT EXECUTE FUNCTION app.wallet_adjustments_reject_mutation();

ALTER TABLE app.wallet_ledger_entries ADD COLUMN adjustment_id uuid;
-- (No CHECK ties the kind to the column: the gate below already requires an adjustment_id for every adjustment row, and the older suites that lift the gate to
-- fund a wallet keep working.)
ALTER TABLE app.wallet_ledger_entries ADD CONSTRAINT wallet_ledger_entries_adjustment_uq UNIQUE (adjustment_id);
ALTER TABLE app.wallet_ledger_entries ADD CONSTRAINT wallet_ledger_entries_adjustment_fk
  FOREIGN KEY (adjustment_id) REFERENCES app.wallet_adjustments (adjustment_id) ON DELETE RESTRICT;

-- The ledger gate keeps what is open (TOPUP with its topup record; COMMISSION_DEBIT with its CAPTURED hold) and opens the adjustment rows with their own source.
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

-- An adjustment has exactly one ledger row (checked at COMMIT): the decision and the money cannot disagree, whatever the application does.
CREATE FUNCTION app.wallet_adjustment_ledger_assert() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  entries integer;
BEGIN
  SELECT count(*) INTO entries FROM app.wallet_ledger_entries l WHERE l.adjustment_id = NEW.adjustment_id;
  IF entries <> 1 THEN
    RAISE EXCEPTION 'WALLET_INVARIANT_VIOLATION: an adjustment needs exactly one ledger row (found %)', entries USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER wallet_adjustments_ledger_assert AFTER INSERT ON app.wallet_adjustments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.wallet_adjustment_ledger_assert();

-- Down Migration
-- Only for disposable test or experimental databases. Reverse order; no CASCADE and no IF EXISTS: it fails loudly on drift.
-- Safety latch: money that was posted is never dropped. Refused, with the data untouched, if ANY adjustment exists.
LOCK TABLE app.wallet_adjustments, app.wallet_ledger_entries IN ACCESS EXCLUSIVE MODE;
DO $latch$
DECLARE
  rows_found bigint;
BEGIN
  SELECT (SELECT count(*) FROM app.wallet_adjustments) + (SELECT count(*) FROM app.wallet_ledger_entries WHERE adjustment_id IS NOT NULL) INTO rows_found;
  IF rows_found > 0 THEN
    RAISE EXCEPTION 'M04_ADJUSTMENT_DOWN_REFUSED: % adjustment row(s) exist; posted money is never dropped', rows_found USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$latch$;
DROP TRIGGER wallet_adjustments_ledger_assert ON app.wallet_adjustments;
DROP FUNCTION app.wallet_adjustment_ledger_assert();
-- Back to the gate of M07: TOPUP with its record and COMMISSION_DEBIT with its captured hold.
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
  RAISE EXCEPTION 'WALLET_LEDGER_SOURCE_NOT_AVAILABLE: a ledger row needs a valid business source and none exists for it'
    USING ERRCODE = 'restrict_violation';
END;
$$;
ALTER TABLE app.wallet_ledger_entries DROP CONSTRAINT wallet_ledger_entries_adjustment_fk;
ALTER TABLE app.wallet_ledger_entries DROP CONSTRAINT wallet_ledger_entries_adjustment_uq;
ALTER TABLE app.wallet_ledger_entries DROP COLUMN adjustment_id;
DROP TRIGGER wallet_adjustments_append_only ON app.wallet_adjustments;
DROP FUNCTION app.wallet_adjustments_reject_mutation();
DROP TABLE app.wallet_adjustments;
