-- Up Migration
-- M01-ADMIN local test activation: phone verification mode of an activation attempt (REQUIRED | DISABLED_TEST).
--
-- Contract of 2026-10-13 (docs/tasks/M01-admin-activation-test-handoff-20261013.md, points 3 and 4):
--   * Every attempt records, at creation and immutably, the mode of the server process that created it. Existing and future
--     REQUIRED attempts keep the state machine STARTED -> OTP_VERIFIED -> PASSWORD_SET -> TOTP_ISSUED -> COMPLETED unchanged.
--   * A DISABLED_TEST attempt goes STARTED -> PASSWORD_SET directly. It never has otp_verified_at (nothing invents it), never
--     is OTP_VERIFIED, and still needs a real TOTP: PASSWORD_SET -> TOTP_ISSUED -> COMPLETED is unchanged.
--   * Nothing is removed globally: the state CHECK and the transition trigger are replaced by versions that are exact per
--     mode, and the secret/counter protections of the old trigger are kept line for line.
--   * An admin profile created by a DISABLED_TEST activation has no phone_verified_at. That column becomes nullable and a
--     deferred constraint admits NULL only for a profile whose activation attempt is COMPLETED in DISABLED_TEST mode.
--
-- Append-only: the 1792281600000 migration is not edited. No IF [NOT] EXISTS: schema drift (a missing or renamed object) must
-- fail and roll the whole migration back.

ALTER TABLE app.admin_activation_attempts
  ADD COLUMN phone_verification_mode varchar(16) NOT NULL DEFAULT 'REQUIRED'
  CONSTRAINT admin_activation_attempts_phone_verification_mode_ck CHECK (phone_verification_mode IN ('REQUIRED','DISABLED_TEST'));

-- The state CHECK of 1792281600000 is unnamed (PostgreSQL named it). Find it by what it says, and require exactly one match.
DO $$
DECLARE
  found_name text;
  found_count integer := 0;
BEGIN
  FOR found_name IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'app.admin_activation_attempts'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%OTP_VERIFIED%'
       AND pg_get_constraintdef(oid) LIKE '%password_hash IS NOT NULL%'
       AND pg_get_constraintdef(oid) LIKE '%invalidated_reason IS NOT NULL%'
  LOOP
    found_count := found_count + 1;
    EXECUTE format('ALTER TABLE app.admin_activation_attempts DROP CONSTRAINT %I', found_name);
  END LOOP;
  IF found_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one activation attempt state CHECK, found %', found_count;
  END IF;
END
$$;

ALTER TABLE app.admin_activation_attempts
  ADD CONSTRAINT admin_activation_attempts_state_ck CHECK (
    (phone_verification_mode = 'REQUIRED' AND (
        (status = 'STARTED'      AND otp_verified_at IS NULL     AND password_set_at IS NULL     AND password_hash IS NULL
         AND totp_issued_at IS NULL
         AND completed_at IS NULL AND invalidated_at IS NULL AND invalidated_reason IS NULL)
     OR (status = 'OTP_VERIFIED' AND otp_verified_at IS NOT NULL AND password_set_at IS NULL     AND password_hash IS NULL
         AND totp_issued_at IS NULL
         AND completed_at IS NULL AND invalidated_at IS NULL AND invalidated_reason IS NULL)
     OR (status = 'PASSWORD_SET' AND otp_verified_at IS NOT NULL AND password_set_at IS NOT NULL AND password_hash IS NOT NULL
         AND totp_issued_at IS NULL
         AND completed_at IS NULL AND invalidated_at IS NULL AND invalidated_reason IS NULL)
     OR (status = 'TOTP_ISSUED'  AND otp_verified_at IS NOT NULL AND password_set_at IS NOT NULL AND password_hash IS NOT NULL
         AND totp_issued_at IS NOT NULL
         AND completed_at IS NULL AND invalidated_at IS NULL AND invalidated_reason IS NULL)
     OR (status = 'COMPLETED'    AND otp_verified_at IS NOT NULL AND password_set_at IS NOT NULL AND password_hash IS NULL
         AND totp_issued_at IS NULL
         AND completed_at IS NOT NULL AND invalidated_at IS NULL AND invalidated_reason IS NULL)
     OR (status = 'INVALIDATED'  AND password_hash IS NULL       AND totp_issued_at IS NULL
         AND completed_at IS NULL AND invalidated_at IS NOT NULL AND invalidated_reason IS NOT NULL)))
    OR
    (phone_verification_mode = 'DISABLED_TEST' AND otp_verified_at IS NULL AND (
        (status = 'STARTED'      AND password_set_at IS NULL     AND password_hash IS NULL
         AND totp_issued_at IS NULL
         AND completed_at IS NULL AND invalidated_at IS NULL AND invalidated_reason IS NULL)
     OR (status = 'PASSWORD_SET' AND password_set_at IS NOT NULL AND password_hash IS NOT NULL
         AND totp_issued_at IS NULL
         AND completed_at IS NULL AND invalidated_at IS NULL AND invalidated_reason IS NULL)
     OR (status = 'TOTP_ISSUED'  AND password_set_at IS NOT NULL AND password_hash IS NOT NULL
         AND totp_issued_at IS NOT NULL
         AND completed_at IS NULL AND invalidated_at IS NULL AND invalidated_reason IS NULL)
     OR (status = 'COMPLETED'    AND password_set_at IS NOT NULL AND password_hash IS NULL
         AND totp_issued_at IS NULL
         AND completed_at IS NOT NULL AND invalidated_at IS NULL AND invalidated_reason IS NULL)
     OR (status = 'INVALIDATED'  AND password_hash IS NULL       AND totp_issued_at IS NULL
         AND completed_at IS NULL AND invalidated_at IS NOT NULL AND invalidated_reason IS NOT NULL)))
  );

-- Transition guard: the 1792281600000 function with exactly three differences, marked (A), (B) and (C).
CREATE OR REPLACE FUNCTION app.admin_activation_attempt_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'admin activation attempt deletion forbidden' USING ERRCODE = '23001';
 END IF;
 -- (A) the mode is part of the immutable identity of the attempt.
 IF ROW(NEW.attempt_id,NEW.invitation_id,NEW.generation_id,NEW.user_id,NEW.factor_id,NEW.token_digest,NEW.csrf_nonce,NEW.csrf_key_id,NEW.created_at,NEW.expires_at,NEW.phone_verification_mode)
  IS DISTINCT FROM
    ROW(OLD.attempt_id,OLD.invitation_id,OLD.generation_id,OLD.user_id,OLD.factor_id,OLD.token_digest,OLD.csrf_nonce,OLD.csrf_key_id,OLD.created_at,OLD.expires_at,OLD.phone_verification_mode) THEN
  RAISE EXCEPTION 'admin activation attempt identity immutable' USING ERRCODE = '23001';
 END IF;
 IF OLD.status IN ('COMPLETED','INVALIDATED') THEN
  RAISE EXCEPTION 'admin activation attempt is terminal' USING ERRCODE = '23001';
 END IF;
 IF NEW.status = 'INVALIDATED' THEN
  IF NEW.invalidated_reason = 'ATTEMPTS_EXHAUSTED' THEN
   IF OLD.status = 'TOTP_ISSUED' AND NEW.totp_attempt_count = OLD.totp_attempt_count + 1 AND NEW.totp_attempt_count = 5 THEN RETURN NEW; END IF;
  ELSIF NEW.totp_attempt_count = OLD.totp_attempt_count THEN
   RETURN NEW;
  END IF;
 -- (B) OTP_VERIFIED exists only in REQUIRED mode.
 ELSIF OLD.status = 'STARTED' AND NEW.status = 'OTP_VERIFIED' AND NEW.phone_verification_mode = 'REQUIRED' AND NEW.totp_attempt_count = OLD.totp_attempt_count THEN
  RETURN NEW;
 -- (C) DISABLED_TEST: STARTED -> PASSWORD_SET directly, with no OTP fact at all (otp_verified_at stays NULL).
 ELSIF OLD.status = 'STARTED' AND NEW.status = 'PASSWORD_SET' AND NEW.phone_verification_mode = 'DISABLED_TEST' AND NEW.totp_attempt_count = OLD.totp_attempt_count
   AND OLD.otp_verified_at IS NULL AND NEW.otp_verified_at IS NULL THEN
  RETURN NEW;
 ELSIF OLD.status = 'OTP_VERIFIED' AND NEW.status = 'PASSWORD_SET' AND NEW.totp_attempt_count = OLD.totp_attempt_count
   AND NEW.otp_verified_at IS NOT DISTINCT FROM OLD.otp_verified_at THEN
  RETURN NEW;
 ELSIF OLD.status = 'PASSWORD_SET' AND NEW.status = 'TOTP_ISSUED' AND NEW.totp_attempt_count = OLD.totp_attempt_count
   AND ROW(NEW.otp_verified_at,NEW.password_hash,NEW.password_set_at) IS NOT DISTINCT FROM ROW(OLD.otp_verified_at,OLD.password_hash,OLD.password_set_at) THEN
  RETURN NEW;
 ELSIF OLD.status = 'TOTP_ISSUED' AND NEW.status = 'TOTP_ISSUED' AND NEW.totp_attempt_count = OLD.totp_attempt_count + 1 AND NEW.totp_attempt_count < 5
   AND ROW(NEW.otp_verified_at,NEW.password_hash,NEW.password_set_at,NEW.totp_key_id,NEW.totp_ciphertext,NEW.totp_iv,NEW.totp_tag,NEW.totp_issued_at)
       IS NOT DISTINCT FROM
       ROW(OLD.otp_verified_at,OLD.password_hash,OLD.password_set_at,OLD.totp_key_id,OLD.totp_ciphertext,OLD.totp_iv,OLD.totp_tag,OLD.totp_issued_at) THEN
  RETURN NEW;
 ELSIF OLD.status = 'TOTP_ISSUED' AND NEW.status = 'COMPLETED' AND NEW.totp_attempt_count = OLD.totp_attempt_count
   AND NEW.otp_verified_at IS NOT DISTINCT FROM OLD.otp_verified_at AND NEW.password_set_at IS NOT DISTINCT FROM OLD.password_set_at THEN
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'invalid admin activation attempt transition' USING ERRCODE = '23001';
END $$;

-- An admin profile made by a DISABLED_TEST activation has no phone verification time (nothing invents it).
ALTER TABLE app.admin_profiles ALTER COLUMN phone_verified_at DROP NOT NULL;

-- NULL is admitted only for a profile whose own activation attempt is COMPLETED in DISABLED_TEST mode, checked at COMMIT
-- (the attempt is completed after the profile is inserted, in the same transaction).
CREATE FUNCTION app.admin_profile_phone_verification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.phone_verified_at IS NULL AND NOT EXISTS (
   SELECT 1 FROM app.admin_activation_attempts a
    WHERE a.invitation_id = NEW.invitation_id AND a.user_id = NEW.user_id
      AND a.status = 'COMPLETED' AND a.phone_verification_mode = 'DISABLED_TEST') THEN
  RAISE EXCEPTION 'admin profile without phone verification requires a completed DISABLED_TEST activation' USING ERRCODE = '23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER admin_profile_phone_verification_guard AFTER INSERT ON app.admin_profiles
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.admin_profile_phone_verification_guard();

-- Down Migration
-- Only for disposable test or experimental databases. It REFUSES to run while a DISABLED_TEST attempt or a profile without a
-- phone verification time exists: it never deletes or rewrites a row to make itself succeed, fails loudly and changes nothing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.admin_activation_attempts WHERE phone_verification_mode <> 'REQUIRED')
     OR EXISTS (SELECT 1 FROM app.admin_profiles WHERE phone_verified_at IS NULL) THEN
    RAISE EXCEPTION 'cannot roll back phone verification mode: DISABLED_TEST activation data exists';
  END IF;
END
$$;

DROP TRIGGER admin_profile_phone_verification_guard ON app.admin_profiles;
DROP FUNCTION app.admin_profile_phone_verification_guard();
ALTER TABLE app.admin_profiles ALTER COLUMN phone_verified_at SET NOT NULL;

CREATE OR REPLACE FUNCTION app.admin_activation_attempt_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'admin activation attempt deletion forbidden' USING ERRCODE = '23001';
 END IF;
 IF ROW(NEW.attempt_id,NEW.invitation_id,NEW.generation_id,NEW.user_id,NEW.factor_id,NEW.token_digest,NEW.csrf_nonce,NEW.csrf_key_id,NEW.created_at,NEW.expires_at)
  IS DISTINCT FROM
    ROW(OLD.attempt_id,OLD.invitation_id,OLD.generation_id,OLD.user_id,OLD.factor_id,OLD.token_digest,OLD.csrf_nonce,OLD.csrf_key_id,OLD.created_at,OLD.expires_at) THEN
  RAISE EXCEPTION 'admin activation attempt identity immutable' USING ERRCODE = '23001';
 END IF;
 IF OLD.status IN ('COMPLETED','INVALIDATED') THEN
  RAISE EXCEPTION 'admin activation attempt is terminal' USING ERRCODE = '23001';
 END IF;
 IF NEW.status = 'INVALIDATED' THEN
  IF NEW.invalidated_reason = 'ATTEMPTS_EXHAUSTED' THEN
   IF OLD.status = 'TOTP_ISSUED' AND NEW.totp_attempt_count = OLD.totp_attempt_count + 1 AND NEW.totp_attempt_count = 5 THEN RETURN NEW; END IF;
  ELSIF NEW.totp_attempt_count = OLD.totp_attempt_count THEN
   RETURN NEW;
  END IF;
 ELSIF OLD.status = 'STARTED' AND NEW.status = 'OTP_VERIFIED' AND NEW.totp_attempt_count = OLD.totp_attempt_count THEN
  RETURN NEW;
 ELSIF OLD.status = 'OTP_VERIFIED' AND NEW.status = 'PASSWORD_SET' AND NEW.totp_attempt_count = OLD.totp_attempt_count
   AND NEW.otp_verified_at IS NOT DISTINCT FROM OLD.otp_verified_at THEN
  RETURN NEW;
 ELSIF OLD.status = 'PASSWORD_SET' AND NEW.status = 'TOTP_ISSUED' AND NEW.totp_attempt_count = OLD.totp_attempt_count
   AND ROW(NEW.otp_verified_at,NEW.password_hash,NEW.password_set_at) IS NOT DISTINCT FROM ROW(OLD.otp_verified_at,OLD.password_hash,OLD.password_set_at) THEN
  RETURN NEW;
 ELSIF OLD.status = 'TOTP_ISSUED' AND NEW.status = 'TOTP_ISSUED' AND NEW.totp_attempt_count = OLD.totp_attempt_count + 1 AND NEW.totp_attempt_count < 5
   AND ROW(NEW.otp_verified_at,NEW.password_hash,NEW.password_set_at,NEW.totp_key_id,NEW.totp_ciphertext,NEW.totp_iv,NEW.totp_tag,NEW.totp_issued_at)
       IS NOT DISTINCT FROM
       ROW(OLD.otp_verified_at,OLD.password_hash,OLD.password_set_at,OLD.totp_key_id,OLD.totp_ciphertext,OLD.totp_iv,OLD.totp_tag,OLD.totp_issued_at) THEN
  RETURN NEW;
 ELSIF OLD.status = 'TOTP_ISSUED' AND NEW.status = 'COMPLETED' AND NEW.totp_attempt_count = OLD.totp_attempt_count
   AND NEW.otp_verified_at IS NOT DISTINCT FROM OLD.otp_verified_at AND NEW.password_set_at IS NOT DISTINCT FROM OLD.password_set_at THEN
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'invalid admin activation attempt transition' USING ERRCODE = '23001';
END $$;

ALTER TABLE app.admin_activation_attempts DROP CONSTRAINT admin_activation_attempts_state_ck;
ALTER TABLE app.admin_activation_attempts
  ADD CONSTRAINT admin_activation_attempts_state_ck CHECK (
    (status = 'STARTED'      AND otp_verified_at IS NULL     AND password_set_at IS NULL     AND password_hash IS NULL
     AND totp_issued_at IS NULL
     AND completed_at IS NULL AND invalidated_at IS NULL AND invalidated_reason IS NULL)
 OR (status = 'OTP_VERIFIED' AND otp_verified_at IS NOT NULL AND password_set_at IS NULL     AND password_hash IS NULL
     AND totp_issued_at IS NULL
     AND completed_at IS NULL AND invalidated_at IS NULL AND invalidated_reason IS NULL)
 OR (status = 'PASSWORD_SET' AND otp_verified_at IS NOT NULL AND password_set_at IS NOT NULL AND password_hash IS NOT NULL
     AND totp_issued_at IS NULL
     AND completed_at IS NULL AND invalidated_at IS NULL AND invalidated_reason IS NULL)
 OR (status = 'TOTP_ISSUED'  AND otp_verified_at IS NOT NULL AND password_set_at IS NOT NULL AND password_hash IS NOT NULL
     AND totp_issued_at IS NOT NULL
     AND completed_at IS NULL AND invalidated_at IS NULL AND invalidated_reason IS NULL)
 OR (status = 'COMPLETED'    AND otp_verified_at IS NOT NULL AND password_set_at IS NOT NULL AND password_hash IS NULL
     AND totp_issued_at IS NULL
     AND completed_at IS NOT NULL AND invalidated_at IS NULL AND invalidated_reason IS NULL)
 OR (status = 'INVALIDATED'  AND password_hash IS NULL       AND totp_issued_at IS NULL
     AND completed_at IS NULL AND invalidated_at IS NOT NULL AND invalidated_reason IS NOT NULL));

ALTER TABLE app.admin_activation_attempts DROP COLUMN phone_verification_mode;
