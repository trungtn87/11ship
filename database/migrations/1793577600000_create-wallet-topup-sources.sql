-- Up Migration
-- M04-B1: the topup SOURCE and bank-document core (docs/tasks/M04-B-topup-implementation-20261017.md, ADR-004 sections 4-6).
--
-- Scope of THIS migration: the tables that make money received from a bank traceable (system receiving accounts, topup requests, the
-- shared bank-transaction registry, confirmed topups) and the typed ledger source column for TOPUP, with every cross-table rule enforced by
-- the database. NOT in scope (B2/B3): any writer, grant, endpoint or screen; the ledger source gate of M04-A1 is NOT touched, so the
-- ledger (and therefore every money posting) stays closed and fail closed.
--
-- Safe on a database that has data: it only ADDS four tables, their functions and triggers, one UNIQUE constraint on app.driver_wallets
-- (wallet_id, driver_id; additive) and one nullable column with its constraints on app.wallet_ledger_entries (empty by the A1 gate,
-- asserted below). No wallet, ledger, hold or M03 row is read-modified; nothing is dropped; no CASCADE. Earlier migrations are not edited.
--
-- HOW MONEY BECOMES POSTABLE LATER (B2, ONE atomic migration): replace app.wallet_ledger_source_gate() so that it accepts exactly a row of
-- kind TOPUP whose topup_id points to an existing topup of the same wallet and amount (the composite FK below already proves it at
-- COMMIT), keep every other kind refused, then grant the narrow privileges the topup participant needs. Until then no ledger row exists,
-- and a topup cannot commit without its ledger row (wallet_topup_assert_posted), so no topup, bank record or CONFIRMED request can exist
-- either: the money path is closed by integrity, not only by grants.
--
-- THE LINKS (all enforced by foreign keys or deferred constraint triggers, none by application code):
--   request --(request_id, wallet_id)--> topup           a CONFIRMED request has exactly one topup of its own wallet; PENDING / REJECTED /
--                                                         CANCELLED requests have none (wallet_topup_request_assert, at COMMIT)
--   topup <--(topup_id, bank_record_id, amount)--> bank   two composite DEFERRABLE foreign keys: the bank IN record and the topup point at
--                                                         each other with the same actual amount
--   ledger TOPUP --(topup_id, wallet_id, delta)--> topup  same topup, same wallet, delta = actual amount; UNIQUE(topup_id) = at most one
--                                                         credit, wallet_topup_assert_posted = at least one

-- The composite foreign key from a request needs the wallet and its driver to agree.
ALTER TABLE app.driver_wallets ADD CONSTRAINT driver_wallets_wallet_driver_uq UNIQUE (wallet_id, driver_id);

-- ---------------------------------------------------------------------------------------------------
-- app.system_owned_bank_accounts: the receiving accounts OF THE SYSTEM (never a Shipper's, never free text from a client)
-- ---------------------------------------------------------------------------------------------------
-- No row is created here: no account number is invented. A later SYSTEM-only package configures the real account. Identity (bank, number,
-- holder) is immutable; only can_receive can change. A bank record can only be registered against an account with can_receive = true.
CREATE TABLE app.system_owned_bank_accounts (
  system_account_id uuid NOT NULL,
  bank_id varchar(16) NOT NULL,
  account_number varchar(20) NOT NULL,
  account_holder varchar(120) NOT NULL,
  can_receive boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT system_owned_bank_accounts_pkey PRIMARY KEY (system_account_id),
  CONSTRAINT system_owned_bank_accounts_account_uq UNIQUE (bank_id, account_number),
  CONSTRAINT system_owned_bank_accounts_bank_uq UNIQUE (system_account_id, bank_id),
  CONSTRAINT system_owned_bank_accounts_bank_ck CHECK (bank_id ~ '^[A-Z0-9]{2,16}$'),
  CONSTRAINT system_owned_bank_accounts_number_ck CHECK (account_number ~ '^[0-9]{6,20}$'),
  CONSTRAINT system_owned_bank_accounts_holder_ck CHECK (length(btrim(account_holder)) >= 1),
  CONSTRAINT system_owned_bank_accounts_version_ck CHECK (version >= 1),
  CONSTRAINT system_owned_bank_accounts_time_order_ck CHECK (updated_at >= created_at)
);

CREATE FUNCTION app.wallet_system_accounts_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 THEN
      RAISE EXCEPTION 'WALLET_SYSTEM_ACCOUNT_MUST_START_AT_VERSION_1' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.system_account_id <> OLD.system_account_id OR NEW.bank_id <> OLD.bank_id OR NEW.account_number <> OLD.account_number
     OR NEW.account_holder <> OLD.account_holder OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'WALLET_SYSTEM_ACCOUNT_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'WALLET_SYSTEM_ACCOUNT_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wallet_system_accounts_guard BEFORE INSERT OR UPDATE ON app.system_owned_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION app.wallet_system_accounts_guard();

-- Shared "never deleted" rule (statement level, so it fires even when no row matches). One function, named per use below.
CREATE FUNCTION app.wallet_topup_reject_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is never deleted (% rejected)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER wallet_system_accounts_no_delete BEFORE DELETE OR TRUNCATE ON app.system_owned_bank_accounts
  FOR EACH STATEMENT EXECUTE FUNCTION app.wallet_topup_reject_delete();

-- ---------------------------------------------------------------------------------------------------
-- app.wallet_topup_requests: what a Shipper ASKS for. A request never moves money.
-- ---------------------------------------------------------------------------------------------------
-- PENDING -> CONFIRMED | REJECTED | CANCELLED, once. The minimum amount is a creation-time rule of the service (app.shipper_wallet_parameters),
-- not a table rule. CONFIRMED is reachable only together with a topup of the request (wallet_topup_request_assert).
CREATE TABLE app.wallet_topup_requests (
  request_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  amount_requested_vnd bigint NOT NULL,
  state varchar(12) NOT NULL DEFAULT 'PENDING',
  created_by_user_id uuid NOT NULL,
  resolved_by_user_id uuid,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  resolved_at timestamptz,

  CONSTRAINT wallet_topup_requests_pkey PRIMARY KEY (request_id),
  CONSTRAINT wallet_topup_requests_owner_fk FOREIGN KEY (wallet_id, driver_id) REFERENCES app.driver_wallets (wallet_id, driver_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_topup_requests_driver_fk FOREIGN KEY (driver_id) REFERENCES app.drivers (driver_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_topup_requests_created_by_fk FOREIGN KEY (created_by_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_topup_requests_resolved_by_fk FOREIGN KEY (resolved_by_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_topup_requests_wallet_uq UNIQUE (request_id, wallet_id),
  CONSTRAINT wallet_topup_requests_amount_ck CHECK (amount_requested_vnd > 0 AND amount_requested_vnd <= 9007199254740991),
  CONSTRAINT wallet_topup_requests_state_ck CHECK (state IN ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT wallet_topup_requests_resolved_ck CHECK ((state = 'PENDING') = (resolved_at IS NULL AND resolved_by_user_id IS NULL)),
  CONSTRAINT wallet_topup_requests_version_ck CHECK (version >= 1),
  CONSTRAINT wallet_topup_requests_time_order_ck CHECK (updated_at >= created_at AND (resolved_at IS NULL OR resolved_at >= created_at))
);
CREATE INDEX wallet_topup_requests_wallet_state_idx ON app.wallet_topup_requests (wallet_id, state);

CREATE FUNCTION app.wallet_topup_requests_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'PENDING' OR NEW.version <> 1 OR NEW.resolved_at IS NOT NULL OR NEW.resolved_by_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'WALLET_TOPUP_REQUEST_MUST_START_PENDING' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.request_id <> OLD.request_id OR NEW.wallet_id <> OLD.wallet_id OR NEW.driver_id <> OLD.driver_id
     OR NEW.amount_requested_vnd <> OLD.amount_requested_vnd OR NEW.created_by_user_id <> OLD.created_by_user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'WALLET_TOPUP_REQUEST_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.state <> 'PENDING' OR NEW.state NOT IN ('CONFIRMED', 'REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'WALLET_TOPUP_REQUEST_TRANSITION_REFUSED: % -> %', OLD.state, NEW.state USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'WALLET_TOPUP_REQUEST_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wallet_topup_requests_guard BEFORE INSERT OR UPDATE ON app.wallet_topup_requests
  FOR EACH ROW EXECUTE FUNCTION app.wallet_topup_requests_guard();
CREATE TRIGGER wallet_topup_requests_no_delete BEFORE DELETE OR TRUNCATE ON app.wallet_topup_requests
  FOR EACH STATEMENT EXECUTE FUNCTION app.wallet_topup_reject_delete();

-- ---------------------------------------------------------------------------------------------------
-- app.wallet_bank_transactions: the ONE registry of bank transactions (IN now, OUT for withdrawals later)
-- ---------------------------------------------------------------------------------------------------
-- The canonical identity (bank, system account, transaction id of the bank statement) is unique and says nothing about a driver, an admin or
-- a request: the same bank transaction can never be recorded twice, whoever records it. The transaction id is stored exactly as the
-- statement gives it, only trimmed at the edges (a value with edge whitespace or control characters is refused, not rewritten).
-- Append-only. OUT (withdrawals) is refused until M04-C provides the source.
CREATE TABLE app.wallet_bank_transactions (
  bank_record_id uuid NOT NULL,
  bank_id varchar(16) NOT NULL,
  system_owned_account_id uuid NOT NULL,
  canonical_transaction_id varchar(128) NOT NULL,
  direction varchar(3) NOT NULL,
  amount_vnd bigint NOT NULL,
  occurred_at timestamptz NOT NULL,
  topup_id uuid,
  withdrawal_id uuid,
  created_at timestamptz NOT NULL,

  CONSTRAINT wallet_bank_transactions_pkey PRIMARY KEY (bank_record_id),
  CONSTRAINT wallet_bank_transactions_account_fk FOREIGN KEY (system_owned_account_id, bank_id)
    REFERENCES app.system_owned_bank_accounts (system_account_id, bank_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_bank_transactions_identity_uq UNIQUE (bank_id, system_owned_account_id, canonical_transaction_id),
  CONSTRAINT wallet_bank_transactions_topup_uq UNIQUE (topup_id),
  CONSTRAINT wallet_bank_transactions_withdrawal_uq UNIQUE (withdrawal_id),
  CONSTRAINT wallet_bank_transactions_link_uq UNIQUE (bank_record_id, topup_id, amount_vnd),
  CONSTRAINT wallet_bank_transactions_txid_ck CHECK (
    canonical_transaction_id ~ '^[^[:space:][:cntrl:]]([^[:cntrl:]]*[^[:space:][:cntrl:]])?$' AND length(canonical_transaction_id) <= 128
  ),
  CONSTRAINT wallet_bank_transactions_direction_ck CHECK (direction IN ('IN', 'OUT')),
  CONSTRAINT wallet_bank_transactions_amount_ck CHECK (amount_vnd > 0 AND amount_vnd <= 9007199254740991),
  -- Exactly the typed source of the direction. withdrawal_id has no foreign key yet (M04-C creates the table) and OUT is refused below.
  CONSTRAINT wallet_bank_transactions_source_ck CHECK (
    (direction = 'IN' AND topup_id IS NOT NULL AND withdrawal_id IS NULL)
    OR (direction = 'OUT' AND withdrawal_id IS NOT NULL AND topup_id IS NULL)
  )
);

CREATE FUNCTION app.wallet_bank_transactions_gate() RETURNS trigger
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
CREATE TRIGGER wallet_bank_transactions_a_gate BEFORE INSERT ON app.wallet_bank_transactions
  FOR EACH ROW EXECUTE FUNCTION app.wallet_bank_transactions_gate();

CREATE FUNCTION app.wallet_topup_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER wallet_bank_transactions_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON app.wallet_bank_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION app.wallet_topup_reject_mutation();

-- ---------------------------------------------------------------------------------------------------
-- app.wallet_topups: money CONFIRMED as received (append-only)
-- ---------------------------------------------------------------------------------------------------
-- actual_amount_vnd is what the bank statement shows, which may differ from the request. The request link is optional (a direct record by an
-- authorised admin has none) but, when present, belongs to the same wallet and is single-use.
CREATE TABLE app.wallet_topups (
  topup_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  request_id uuid,
  bank_record_id uuid NOT NULL,
  actual_amount_vnd bigint NOT NULL,
  received_at timestamptz NOT NULL,
  confirmed_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL,

  CONSTRAINT wallet_topups_pkey PRIMARY KEY (topup_id),
  CONSTRAINT wallet_topups_wallet_fk FOREIGN KEY (wallet_id) REFERENCES app.driver_wallets (wallet_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_topups_request_fk FOREIGN KEY (request_id, wallet_id) REFERENCES app.wallet_topup_requests (request_id, wallet_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_topups_confirmed_by_fk FOREIGN KEY (confirmed_by_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_topups_request_uq UNIQUE (request_id),
  CONSTRAINT wallet_topups_bank_record_uq UNIQUE (bank_record_id),
  CONSTRAINT wallet_topups_bank_link_uq UNIQUE (topup_id, bank_record_id, actual_amount_vnd),
  CONSTRAINT wallet_topups_ledger_link_uq UNIQUE (topup_id, wallet_id, actual_amount_vnd),
  CONSTRAINT wallet_topups_amount_ck CHECK (actual_amount_vnd > 0 AND actual_amount_vnd <= 9007199254740991)
);

-- The topup and its bank IN record point at each other with the same amount. Both directions are DEFERRABLE INITIALLY DEFERRED, so the two
-- rows can be inserted in either order inside one transaction, and neither can commit without the other.
ALTER TABLE app.wallet_topups ADD CONSTRAINT wallet_topups_bank_fk
  FOREIGN KEY (bank_record_id, topup_id, actual_amount_vnd) REFERENCES app.wallet_bank_transactions (bank_record_id, topup_id, amount_vnd)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app.wallet_bank_transactions ADD CONSTRAINT wallet_bank_transactions_topup_fk
  FOREIGN KEY (topup_id, bank_record_id, amount_vnd) REFERENCES app.wallet_topups (topup_id, bank_record_id, actual_amount_vnd)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION app.wallet_topups_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  -- The wallet row lock first (as the ledger chain does), so even a writer that forgot it is serialised per wallet.
  PERFORM 1 FROM app.driver_wallets WHERE wallet_id = NEW.wallet_id FOR UPDATE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wallet_topups_guard BEFORE INSERT ON app.wallet_topups
  FOR EACH ROW EXECUTE FUNCTION app.wallet_topups_guard();
CREATE TRIGGER wallet_topups_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON app.wallet_topups
  FOR EACH STATEMENT EXECUTE FUNCTION app.wallet_topup_reject_mutation();

-- ---------------------------------------------------------------------------------------------------
-- The typed ledger source for TOPUP (the A1 source gate stays as it is: it still refuses every ledger INSERT)
-- ---------------------------------------------------------------------------------------------------
DO $assert$
BEGIN
  IF EXISTS (SELECT 1 FROM app.wallet_ledger_entries) THEN
    RAISE EXCEPTION 'WALLET_TOPUP_SOURCE_MIGRATION_REFUSED: the ledger must still be empty' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$assert$;
ALTER TABLE app.wallet_ledger_entries ADD COLUMN topup_id uuid;
-- TOPUP rows have exactly their topup; every other kind has no source here and cannot pretend to have one.
ALTER TABLE app.wallet_ledger_entries ADD CONSTRAINT wallet_ledger_entries_topup_source_ck CHECK ((entry_kind = 'TOPUP') = (topup_id IS NOT NULL));
ALTER TABLE app.wallet_ledger_entries ADD CONSTRAINT wallet_ledger_entries_topup_uq UNIQUE (topup_id);
-- Same topup, same wallet, delta = the actual amount: a credit of any other size or on any other wallet cannot commit.
ALTER TABLE app.wallet_ledger_entries ADD CONSTRAINT wallet_ledger_entries_topup_fk
  FOREIGN KEY (topup_id, wallet_id, delta_vnd) REFERENCES app.wallet_topups (topup_id, wallet_id, actual_amount_vnd)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------------------------------
-- Commit-time invariants
-- ---------------------------------------------------------------------------------------------------
-- A topup that exists has exactly ONE ledger credit of its amount on its wallet (the FK + UNIQUE above bound it from the other side), its
-- request (if any) is CONFIRMED, and the wallet still satisfies the A1/A2.1 invariants (balance = SUM(ledger), held = SUM(ACTIVE holds)).
CREATE FUNCTION app.wallet_topup_assert_posted(target_topup uuid) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  topup_wallet uuid;
  topup_amount bigint;
  topup_request uuid;
  posted bigint;
  request_state varchar;
BEGIN
  SELECT t.wallet_id, t.actual_amount_vnd, t.request_id INTO topup_wallet, topup_amount, topup_request FROM app.wallet_topups t WHERE t.topup_id = target_topup;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT count(*) INTO posted FROM app.wallet_ledger_entries l
    WHERE l.topup_id = target_topup AND l.entry_kind = 'TOPUP' AND l.wallet_id = topup_wallet AND l.delta_vnd = topup_amount;
  IF posted <> 1 THEN
    RAISE EXCEPTION 'WALLET_TOPUP_INVARIANT_VIOLATION: a topup needs exactly one ledger credit of its amount' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF topup_request IS NOT NULL THEN
    SELECT r.state INTO request_state FROM app.wallet_topup_requests r WHERE r.request_id = topup_request;
    IF request_state IS DISTINCT FROM 'CONFIRMED' THEN
      RAISE EXCEPTION 'WALLET_TOPUP_INVARIANT_VIOLATION: only a CONFIRMED request can have a topup' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  PERFORM app.wallet_assert_invariants(topup_wallet);
END;
$$;

CREATE FUNCTION app.wallet_topup_request_assert(target_request uuid) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  request_state varchar;
BEGIN
  SELECT r.state INTO request_state FROM app.wallet_topup_requests r WHERE r.request_id = target_request;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF (request_state = 'CONFIRMED') <> EXISTS (SELECT 1 FROM app.wallet_topups t WHERE t.request_id = target_request) THEN
    RAISE EXCEPTION 'WALLET_TOPUP_INVARIANT_VIOLATION: a request is CONFIRMED if and only if it has its topup' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END;
$$;

CREATE FUNCTION app.wallet_topups_invariants_trigger() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.wallet_topup_assert_posted(NEW.topup_id);
  IF NEW.request_id IS NOT NULL THEN
    PERFORM app.wallet_topup_request_assert(NEW.request_id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE FUNCTION app.wallet_topup_requests_invariants_trigger() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.wallet_topup_request_assert(NEW.request_id);
  RETURN NULL;
END;
$$;
-- A ledger TOPUP row is also checked from its own side (it must have a topup row that is itself consistent).
CREATE FUNCTION app.wallet_topup_ledger_invariants_trigger() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.topup_id IS NOT NULL THEN
    PERFORM app.wallet_topup_assert_posted(NEW.topup_id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER wallet_topups_invariants AFTER INSERT ON app.wallet_topups
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.wallet_topups_invariants_trigger();
CREATE CONSTRAINT TRIGGER wallet_topup_requests_invariants AFTER INSERT OR UPDATE ON app.wallet_topup_requests
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.wallet_topup_requests_invariants_trigger();
CREATE CONSTRAINT TRIGGER wallet_topup_ledger_invariants AFTER INSERT ON app.wallet_ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.wallet_topup_ledger_invariants_trigger();

-- Down Migration
-- Only for disposable test or experimental databases. Reverse order; no CASCADE and no IF EXISTS: it fails loudly on drift.
-- Safety latch: money-source history is never dropped. Every table involved is locked ACCESS EXCLUSIVE first (one statement, one lock
-- order), so nothing can be written between the checks and the DROPs. The down migration is refused, with the data untouched, if ANY
-- system account, request (also a cancelled or rejected one), bank record, topup or ledger credit exists.
LOCK TABLE app.driver_wallets, app.wallet_ledger_entries, app.system_owned_bank_accounts, app.wallet_topup_requests, app.wallet_bank_transactions, app.wallet_topups IN ACCESS EXCLUSIVE MODE;
DO $latch$
DECLARE
  account_rows bigint;
  request_rows bigint;
  bank_rows bigint;
  topup_rows bigint;
  credit_rows bigint;
BEGIN
  SELECT count(*) INTO account_rows FROM app.system_owned_bank_accounts;
  SELECT count(*) INTO request_rows FROM app.wallet_topup_requests;
  SELECT count(*) INTO bank_rows FROM app.wallet_bank_transactions;
  SELECT count(*) INTO topup_rows FROM app.wallet_topups;
  SELECT count(*) INTO credit_rows FROM app.wallet_ledger_entries WHERE topup_id IS NOT NULL;
  IF account_rows > 0 OR request_rows > 0 OR bank_rows > 0 OR topup_rows > 0 OR credit_rows > 0 THEN
    RAISE EXCEPTION 'WALLET_TOPUP_DOWN_REFUSED: % account(s), % request(s), % bank record(s), % topup(s), % ledger credit(s) exist; topup source history is never dropped',
      account_rows, request_rows, bank_rows, topup_rows, credit_rows USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$latch$;
DROP TRIGGER wallet_topup_ledger_invariants ON app.wallet_ledger_entries;
DROP TRIGGER wallet_topup_requests_invariants ON app.wallet_topup_requests;
DROP TRIGGER wallet_topups_invariants ON app.wallet_topups;
DROP FUNCTION app.wallet_topup_ledger_invariants_trigger();
DROP FUNCTION app.wallet_topup_requests_invariants_trigger();
DROP FUNCTION app.wallet_topups_invariants_trigger();
DROP FUNCTION app.wallet_topup_request_assert(uuid);
DROP FUNCTION app.wallet_topup_assert_posted(uuid);
ALTER TABLE app.wallet_ledger_entries DROP CONSTRAINT wallet_ledger_entries_topup_fk;
ALTER TABLE app.wallet_ledger_entries DROP CONSTRAINT wallet_ledger_entries_topup_uq;
ALTER TABLE app.wallet_ledger_entries DROP CONSTRAINT wallet_ledger_entries_topup_source_ck;
ALTER TABLE app.wallet_ledger_entries DROP COLUMN topup_id;
ALTER TABLE app.wallet_bank_transactions DROP CONSTRAINT wallet_bank_transactions_topup_fk;
ALTER TABLE app.wallet_topups DROP CONSTRAINT wallet_topups_bank_fk;
DROP TRIGGER wallet_topups_append_only ON app.wallet_topups;
DROP TRIGGER wallet_topups_guard ON app.wallet_topups;
DROP FUNCTION app.wallet_topups_guard();
DROP TABLE app.wallet_topups;
DROP TRIGGER wallet_bank_transactions_append_only ON app.wallet_bank_transactions;
DROP TRIGGER wallet_bank_transactions_a_gate ON app.wallet_bank_transactions;
DROP FUNCTION app.wallet_topup_reject_mutation();
DROP FUNCTION app.wallet_bank_transactions_gate();
DROP TABLE app.wallet_bank_transactions;
DROP TRIGGER wallet_topup_requests_no_delete ON app.wallet_topup_requests;
DROP TRIGGER wallet_topup_requests_guard ON app.wallet_topup_requests;
DROP FUNCTION app.wallet_topup_requests_guard();
DROP TABLE app.wallet_topup_requests;
DROP TRIGGER wallet_system_accounts_no_delete ON app.system_owned_bank_accounts;
DROP TRIGGER wallet_system_accounts_guard ON app.system_owned_bank_accounts;
DROP FUNCTION app.wallet_topup_reject_delete();
DROP FUNCTION app.wallet_system_accounts_guard();
DROP TABLE app.system_owned_bank_accounts;
ALTER TABLE app.driver_wallets DROP CONSTRAINT driver_wallets_wallet_driver_uq;
