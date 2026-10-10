-- Up Migration
-- Integrated M00-D2 + M01 Admin on a clean staging database.
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

-- Down Migration
-- Refuse to remove ADMIN_PROVISIONED support while any such account exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.users WHERE account_origin = 'ADMIN_PROVISIONED') THEN
    RAISE EXCEPTION 'cannot downgrade account origin: administration accounts exist';
  END IF;
END $$;

ALTER TABLE app.users DROP CONSTRAINT users_origin_verified_ck;
ALTER TABLE app.users DROP CONSTRAINT users_account_origin_ck;
ALTER TABLE app.users ADD CONSTRAINT users_account_origin_ck
  CHECK (account_origin IN ('PHONE_VERIFIED', 'STAGING_FIXTURE'));
ALTER TABLE app.users ADD CONSTRAINT users_origin_verified_ck CHECK (
  (account_origin = 'PHONE_VERIFIED' AND phone_verified_at IS NOT NULL)
  OR (account_origin = 'STAGING_FIXTURE' AND phone_verified_at IS NULL)
);
