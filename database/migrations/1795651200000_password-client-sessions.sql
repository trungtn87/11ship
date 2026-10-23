-- Up Migration
-- Existing sessions remain device-bound. Only credential/OTP-authenticated server code mints PASSWORD sessions.
ALTER TABLE app.sessions ADD COLUMN auth_method varchar(32) NOT NULL DEFAULT 'LEGACY_DEVICE_PROOF'
  CONSTRAINT sessions_auth_method_ck CHECK (auth_method IN ('LEGACY_DEVICE_PROOF', 'PASSWORD'));
ALTER TABLE app.sessions ADD CONSTRAINT sessions_password_client_ck
  CHECK (auth_method <> 'PASSWORD' OR (platform = 'ANDROID' AND app IN ('FOOD', 'SHIP')));
CREATE FUNCTION app.sessions_auth_method_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.auth_method IS DISTINCT FROM OLD.auth_method THEN
    RAISE EXCEPTION 'session authentication method is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sessions_auth_method_immutable_trg BEFORE UPDATE ON app.sessions
  FOR EACH ROW EXECUTE FUNCTION app.sessions_auth_method_immutable();

CREATE TABLE app.client_login_limits (
  bucket_key varchar(64) PRIMARY KEY CHECK (bucket_key ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 31)
);

-- Down Migration
DROP TABLE app.client_login_limits;
-- Never downgrade a password token to a device-proof token or leave it active for older servers.
UPDATE app.sessions SET revoked_at = COALESCE(revoked_at, clock_timestamp()), updated_at = clock_timestamp()
  WHERE auth_method = 'PASSWORD';
DROP TRIGGER sessions_auth_method_immutable_trg ON app.sessions;
DROP FUNCTION app.sessions_auth_method_immutable();
ALTER TABLE app.sessions DROP CONSTRAINT sessions_password_client_ck;
ALTER TABLE app.sessions DROP COLUMN auth_method;
