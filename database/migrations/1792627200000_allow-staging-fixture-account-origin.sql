-- Up Migration
-- M00-D2 reconciled with the current main (issue #49): the STAGING_FIXTURE account origin.
--
-- A fixture account is an ACTIVE user whose phone number was never proven (staging has no SMS provider yet). It is an
-- explicit, DB-visible state, not a made-up timestamp: phone_verified_at stays NULL and account_origin says why. It
-- carries NO privilege: administration rights come only from app.admin_memberships (+ MFA), and the membership origin
-- guard (1792454400000) refuses every account that is not ADMIN_PROVISIONED, so a fixture can never become ADMIN or
-- SYSTEM.
--
-- Why this is a NEW migration that only replaces the two CHECK constraints (and does not add the column again):
--   * 1791936000000_add-users-account-origin.sql is already applied wherever the current main was migrated. It added
--     the column account_origin and both constraints, so the column exists here by construction. Applied migrations
--     are never edited.
--   * The earlier M00-D2 branch (PR #27) added the same column under the name 1791849600000_add-users-account-origin.
--     That file is deliberately NOT part of this history: next to 1791936000000 it would add the column twice and
--     fail on a fresh database. A database that was migrated with that other history is not upgraded by this file;
--     see ops/runbooks/render-supabase-staging.md (migration history of account_origin) for how to recognise it
--     with a read-only query, and docs/evidence/M00-D2-reconcile-49.md for the history matrix.
--   * The timestamp is later than every existing migration, so node-pg-migrate's order check holds on a database that
--     is already at the current main.
--
-- No IF [NOT] EXISTS anywhere: if a constraint is missing or has another name (schema drift) the migration must fail and
-- roll back as a whole instead of hiding it.
--
-- Existing rows stay valid: every row is PHONE_VERIFIED (with a verification time) or ADMIN_PROVISIONED (without one),
-- and both combinations are still accepted below.

ALTER TABLE app.users DROP CONSTRAINT users_origin_verified_ck;
ALTER TABLE app.users DROP CONSTRAINT users_account_origin_ck;

ALTER TABLE app.users
  ADD CONSTRAINT users_account_origin_ck
  CHECK (account_origin IN ('PHONE_VERIFIED', 'ADMIN_PROVISIONED', 'STAGING_FIXTURE'));

-- Pairing: a phone-verified account has a verification time; an administration-provisioned account and a staging
-- fixture never have one (nothing invents it).
ALTER TABLE app.users
  ADD CONSTRAINT users_origin_verified_ck CHECK (
    (account_origin = 'PHONE_VERIFIED' AND phone_verified_at IS NOT NULL)
    OR (account_origin IN ('ADMIN_PROVISIONED', 'STAGING_FIXTURE') AND phone_verified_at IS NULL)
  );

-- Down Migration
-- Only for disposable test or experimental databases. It REFUSES to run while a staging fixture exists (it never
-- deletes or rewrites a fixture to make itself succeed), fails loudly and changes nothing in that case. No CASCADE, no
-- IF EXISTS.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.users WHERE account_origin = 'STAGING_FIXTURE') THEN
    RAISE EXCEPTION 'cannot roll back staging fixture origin: staging fixture accounts exist';
  END IF;
END
$$;

ALTER TABLE app.users DROP CONSTRAINT users_origin_verified_ck;
ALTER TABLE app.users DROP CONSTRAINT users_account_origin_ck;

ALTER TABLE app.users
  ADD CONSTRAINT users_account_origin_ck CHECK (account_origin IN ('PHONE_VERIFIED', 'ADMIN_PROVISIONED'));

ALTER TABLE app.users
  ADD CONSTRAINT users_origin_verified_ck CHECK (
    (account_origin = 'PHONE_VERIFIED' AND phone_verified_at IS NOT NULL)
    OR (account_origin = 'ADMIN_PROVISIONED' AND phone_verified_at IS NULL)
  );
