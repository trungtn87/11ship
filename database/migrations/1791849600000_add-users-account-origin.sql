-- Up Migration
-- M00-D2: account origin for staging fixture accounts (docs/tasks/M00-D2-staging-fixtures.md section 2).
-- A NEW migration after every applied one; applied migrations are never edited.
--
-- A fixture account is an ACTIVE user whose phone number was never proven (no SMS exists on staging yet). It is
-- an explicit, DB-visible state, not a made-up timestamp: phone_verified_at stays NULL and account_origin says why.
-- No OTP challenge, no proof and no role is ever invented for it, and nothing here can turn a fixture into a
-- PHONE_VERIFIED account.
--
-- Existing rows: ADD COLUMN ... DEFAULT backfills every current user as PHONE_VERIFIED. That is correct because
-- phone_verified_at was NOT NULL until this migration, so each existing user was verified by a real proof.
-- No IF [NOT] EXISTS: schema drift must fail loudly and atomically.
ALTER TABLE app.users ADD COLUMN account_origin varchar(24) NOT NULL DEFAULT 'PHONE_VERIFIED';

ALTER TABLE app.users ADD CONSTRAINT users_account_origin_ck
  CHECK (account_origin IN ('PHONE_VERIFIED', 'STAGING_FIXTURE'));

ALTER TABLE app.users ALTER COLUMN phone_verified_at DROP NOT NULL;

-- The two valid combinations and nothing else: a verified account always has its proof time, a fixture never has one.
ALTER TABLE app.users ADD CONSTRAINT users_origin_verified_ck CHECK (
  (account_origin = 'PHONE_VERIFIED' AND phone_verified_at IS NOT NULL)
  OR (account_origin = 'STAGING_FIXTURE' AND phone_verified_at IS NULL)
);

-- Down Migration
-- Only for disposable test or experimental databases. It REFUSES to run while a fixture row exists (a fixture
-- cannot satisfy the NOT NULL it would restore) and never deletes a fixture to make itself succeed. No CASCADE,
-- no IF EXISTS: it fails loudly if anything is missing instead of hiding drift. Dropping the column also drops
-- users_account_origin_ck; users_origin_verified_ck is dropped first, explicitly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.users WHERE phone_verified_at IS NULL OR account_origin <> 'PHONE_VERIFIED') THEN
    RAISE EXCEPTION 'cannot undo account_origin: staging fixture accounts exist';
  END IF;
END
$$;

ALTER TABLE app.users DROP CONSTRAINT users_origin_verified_ck;
ALTER TABLE app.users ALTER COLUMN phone_verified_at SET NOT NULL;
ALTER TABLE app.users DROP COLUMN account_origin;
