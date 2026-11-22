-- Up Migration
-- The commission-policy guard serialised writers with LOCK TABLE ... SHARE ROW EXCLUSIVE. PostgreSQL requires the UPDATE privilege for that lock
-- mode, and the runtime role (ship11_app) has only SELECT, INSERT on app.wallet_commission_policies by design (the table is append-only).
-- So a SYSTEM commission change failed with "permission denied" on the VPS. The guard now takes a transaction-scoped advisory lock instead:
-- it needs no table privilege. The key is the same one CommissionPolicyRepository takes (apps/backend/src/wallet/commission-policy-repository.ts,
-- WALLET_COMMISSION_POLICY_LOCK_KEY). Every insert fires this trigger, so every writer still queues behind the same lock; the check that
-- the version is exactly last + 1 is unchanged.
CREATE OR REPLACE FUNCTION app.wallet_commission_policies_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  last_version integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('11ship.wallet.commission-policy.version.v1', 0));
  SELECT COALESCE(MAX(policy_version), 0) INTO last_version FROM app.wallet_commission_policies;
  IF NEW.policy_version <> last_version + 1 THEN
    RAISE EXCEPTION 'WALLET_COMMISSION_POLICY_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Self-check: the guard is the advisory-lock version and still bound to the table (fails the migration rather than leaving a silent gap).
DO $$
BEGIN
  IF position('pg_advisory_xact_lock' IN pg_get_functiondef('app.wallet_commission_policies_guard()'::regprocedure)) = 0
     OR position('LOCK TABLE' IN pg_get_functiondef('app.wallet_commission_policies_guard()'::regprocedure)) <> 0 THEN
    RAISE EXCEPTION 'wallet_commission_policies_guard was not replaced by the advisory-lock version';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'app.wallet_commission_policies'::regclass AND tgname = 'wallet_commission_policies_guard' AND tgenabled = 'O' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'wallet_commission_policies_guard trigger is missing or disabled';
  END IF;
END;
$$;

-- Down Migration
-- Restores the previous guard (LOCK TABLE ... SHARE ROW EXCLUSIVE). Only valid where the migrator/owner role runs writes; the runtime role
-- would again fail to append a commission version.
CREATE OR REPLACE FUNCTION app.wallet_commission_policies_guard() RETURNS trigger
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
