// Issue #49: the account_origin migrations of the two EARLIER histories (PR #27 and PR #42), kept as test fixtures ONLY.
// They are not part of database/migrations and are never applied by the runner: they exist so the history matrix can
// recreate a database that was migrated with them and prove how the current history behaves on it.

/** PR #27 (M00-D2) 1791849600000_add-users-account-origin: the column with PHONE_VERIFIED/STAGING_FIXTURE only. */
export const D2_ORIGIN_NAME = '1791849600000_add-users-account-origin';
export const D2_ORIGIN_UP_SQL = `-- M00-D2: account origin for staging fixture accounts (docs/tasks/M00-D2-staging-fixtures.md section 2).
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

`;

/** PR #42 (integrated) 1791936000000_add-users-account-origin: replaces the D2 constraints with all three origins. */
export const S42_ORIGIN_NAME = '1791936000000_add-users-account-origin';
export const S42_ORIGIN_UP_SQL = `-- Integrated M00-D2 + M01 Admin on a clean staging database.
-- M00-D2 (1791849600000) already added account_origin as PHONE_VERIFIED/STAGING_FIXTURE.
-- M01 Admin introduces ADMIN_PROVISIONED; do not add the column a second time.
-- Migration names are immutable once deployed; this integrated branch has NOT been applied remotely.
ALTER TABLE app.users DROP CONSTRAINT users_origin_verified_ck;
ALTER TABLE app.users DROP CONSTRAINT users_account_origin_ck;

ALTER TABLE app.users ADD CONSTRAINT users_account_origin_ck
  CHECK (account_origin IN ('PHONE_VERIFIED', 'STAGING_FIXTURE', 'ADMIN_PROVISIONED'));

ALTER TABLE app.users ADD CONSTRAINT users_origin_verified_ck CHECK (
  (account_origin = 'PHONE_VERIFIED' AND phone_verified_at IS NOT NULL)
  OR (account_origin IN ('STAGING_FIXTURE', 'ADMIN_PROVISIONED') AND phone_verified_at IS NULL)
);

`;
