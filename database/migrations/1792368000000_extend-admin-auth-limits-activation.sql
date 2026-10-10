-- Up Migration
-- M01-D-ADMIN-1C migration B: activation limiter kinds.
-- DDL reviewed in docs/tasks/M01-D-ADMIN-1C-technical-contract.md section 5; verified by docs/verification/m01-d-admin-1c-ddl.
ALTER TABLE app.admin_auth_limits DROP CONSTRAINT admin_auth_limits_kind_ck;
ALTER TABLE app.admin_auth_limits ADD CONSTRAINT admin_auth_limits_kind_ck CHECK (
 kind IN ('LOGIN_PHONE','LOGIN_IP','LOGIN_REQUEST_IP','TOTP_USER','TOTP_REQUEST_IP',
          'ACTIVATION_REQUEST_IP','ACTIVATION_LINK_IP','ACTIVATION_OTP_SEND','ACTIVATION_TOTP')
);

-- Down Migration
DO $$
BEGIN
 IF (SELECT count(*) FROM app.admin_auth_limits WHERE kind LIKE 'ACTIVATION\_%') > 0 THEN
  RAISE EXCEPTION 'cannot roll back admin_auth_limits kinds: activation buckets exist';
 END IF;
END
$$;
ALTER TABLE app.admin_auth_limits DROP CONSTRAINT admin_auth_limits_kind_ck;
ALTER TABLE app.admin_auth_limits ADD CONSTRAINT admin_auth_limits_kind_ck CHECK (
 kind IN ('LOGIN_PHONE','LOGIN_IP','LOGIN_REQUEST_IP','TOTP_USER','TOTP_REQUEST_IP')
);
