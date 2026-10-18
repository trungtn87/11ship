-- Up Migration
-- M04-B2.2a: the finance access list of the administration (docs/tasks/M04-B2-2-admin-topup-settlement-20261018.md, ADR-004 section 9).
--
-- One table: app.admin_finance_grants, the rights over MONEY that SYSTEM gives to an ADMIN one function at a time. Default deny: an ADMIN has
-- no row, so no right; the other permission tables (app.admin_app_permissions, the invitation snapshots) are not touched and never imply a
-- finance right. SYSTEM has every finance right implicitly and never appears here (a SYSTEM membership cannot be granted a row).
--
-- Safe on a database that has data: it only ADDS one table, two functions and their triggers. No wallet, ledger, hold, request or M01/M03
-- row is touched; nothing is dropped; no CASCADE. Earlier migrations are not edited. It opens no money path (the ledger gate is untouched).
--
-- permission_key is a dotted name checked by FORMAT only, so a later package (withdrawal, adjustment, driver bank read) can add its key without
-- a schema change; WHICH keys can be granted today is decided by the service (wallet.read, wallet.topup.record), not by this table.
--
-- A grant is one row per (user, key): GRANTED -> REVOKED -> GRANTED again, each change +1 version, who and when kept; the history of the changes
-- is in the audit log. Rows are never deleted.

CREATE TABLE app.admin_finance_grants (
  user_id uuid NOT NULL,
  permission_key varchar(48) NOT NULL,
  state varchar(8) NOT NULL,
  granted_by_user_id uuid NOT NULL,
  granted_at timestamptz NOT NULL,
  revoked_by_user_id uuid,
  revoked_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT admin_finance_grants_pkey PRIMARY KEY (user_id, permission_key),
  CONSTRAINT admin_finance_grants_membership_fk FOREIGN KEY (user_id) REFERENCES app.admin_memberships (user_id) ON DELETE RESTRICT,
  CONSTRAINT admin_finance_grants_granted_by_fk FOREIGN KEY (granted_by_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT admin_finance_grants_revoked_by_fk FOREIGN KEY (revoked_by_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT admin_finance_grants_key_ck CHECK (permission_key ~ '^[a-z]+(\.[a-z]+){1,3}$'),
  CONSTRAINT admin_finance_grants_state_ck CHECK (state IN ('GRANTED', 'REVOKED')),
  -- GRANTED carries no revocation; REVOKED carries both who and when.
  CONSTRAINT admin_finance_grants_revocation_ck CHECK (
    (state = 'GRANTED' AND revoked_by_user_id IS NULL AND revoked_at IS NULL)
    OR (state = 'REVOKED' AND revoked_by_user_id IS NOT NULL AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT admin_finance_grants_version_ck CHECK (version >= 1),
  CONSTRAINT admin_finance_grants_time_order_ck CHECK (updated_at >= created_at AND granted_at >= created_at)
);
CREATE INDEX admin_finance_grants_key_state_idx ON app.admin_finance_grants (permission_key, state);

-- Rules of the row. A right is only ever GIVEN to an ADMIN membership (never SYSTEM, whose rights are implicit); identity never changes;
-- the version advances by exactly one on every change.
CREATE FUNCTION app.admin_finance_grants_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  holder_role varchar;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'GRANTED' OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'FINANCE_GRANT_MUST_START_GRANTED' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.user_id <> OLD.user_id OR NEW.permission_key <> OLD.permission_key OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'FINANCE_GRANT_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'FINANCE_GRANT_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF NEW.state = 'GRANTED' THEN
    SELECT m.admin_role INTO holder_role FROM app.admin_memberships m WHERE m.user_id = NEW.user_id;
    IF holder_role IS DISTINCT FROM 'ADMIN' THEN
      RAISE EXCEPTION 'FINANCE_GRANT_ADMIN_ONLY: a finance right is given to an ADMIN membership only' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER admin_finance_grants_guard BEFORE INSERT OR UPDATE ON app.admin_finance_grants
  FOR EACH ROW EXECUTE FUNCTION app.admin_finance_grants_guard();

CREATE FUNCTION app.admin_finance_grants_reject_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.admin_finance_grants is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER admin_finance_grants_no_delete BEFORE DELETE OR TRUNCATE ON app.admin_finance_grants
  FOR EACH STATEMENT EXECUTE FUNCTION app.admin_finance_grants_reject_delete();

-- Down Migration
-- Only for disposable test or experimental databases. No CASCADE, no IF EXISTS: it fails loudly on drift.
-- Safety latch: the history of who was allowed to handle money is never dropped. The table is locked ACCESS EXCLUSIVE first, so no grant can
-- appear between the check and the DROP; ANY row (a REVOKED one too) refuses the down migration and loses nothing.
LOCK TABLE app.admin_finance_grants IN ACCESS EXCLUSIVE MODE;
DO $latch$
DECLARE
  grant_rows bigint;
BEGIN
  SELECT count(*) INTO grant_rows FROM app.admin_finance_grants;
  IF grant_rows > 0 THEN
    RAISE EXCEPTION 'FINANCE_GRANTS_DOWN_REFUSED: % grant row(s) exist; finance access history is never dropped', grant_rows
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$latch$;
DROP TRIGGER admin_finance_grants_no_delete ON app.admin_finance_grants;
DROP FUNCTION app.admin_finance_grants_reject_delete();
DROP TRIGGER admin_finance_grants_guard ON app.admin_finance_grants;
DROP FUNCTION app.admin_finance_grants_guard();
DROP TABLE app.admin_finance_grants;
