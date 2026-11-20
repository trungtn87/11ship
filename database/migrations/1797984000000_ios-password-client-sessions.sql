-- Up Migration
-- iOS (FOOD / SHIP) signs in with password / OTP like the Android PASSWORD sessions: no native device proof exists for it.
-- Widen only the PASSWORD-session rule to the IOS platform; legacy device-proof sessions stay ANDROID-only (their own constraints).
ALTER TABLE app.sessions DROP CONSTRAINT sessions_password_client_ck;
ALTER TABLE app.sessions ADD CONSTRAINT sessions_password_client_ck
  CHECK (auth_method <> 'PASSWORD' OR (platform IN ('ANDROID', 'IOS') AND app IN ('FOOD', 'SHIP')));

-- Down Migration
-- Never leave a live IOS password token behind: revoke them, then restore the previous rule (NOT VALID keeps the revoked rows).
UPDATE app.sessions SET revoked_at = COALESCE(revoked_at, clock_timestamp()), updated_at = clock_timestamp()
  WHERE auth_method = 'PASSWORD' AND platform = 'IOS';
ALTER TABLE app.sessions DROP CONSTRAINT sessions_password_client_ck;
ALTER TABLE app.sessions ADD CONSTRAINT sessions_password_client_ck
  CHECK (auth_method <> 'PASSWORD' OR (platform = 'ANDROID' AND app IN ('FOOD', 'SHIP'))) NOT VALID;
