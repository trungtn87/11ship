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
