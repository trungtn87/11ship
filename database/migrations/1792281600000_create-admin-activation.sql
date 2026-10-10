-- Up Migration
-- M01-D-ADMIN-1C migration A: activation attempts, OTP challenges, admin profiles and app permissions.
-- DDL reviewed in docs/tasks/M01-D-ADMIN-1C-technical-contract.md section 5; verified by docs/verification/m01-d-admin-1c-ddl.
CREATE TABLE app.admin_activation_attempts (
 attempt_id uuid PRIMARY KEY,
 invitation_id uuid NOT NULL,
 generation_id uuid NOT NULL,
 -- Pre-allocated identities of the account that exists only after COMPLETED (no foreign key on purpose). They are
 -- the AEAD associated data of the TOTP secret and the input of the password binding, so they must be fixed first.
 user_id uuid NOT NULL UNIQUE,
 factor_id uuid NOT NULL UNIQUE,
 -- Digest of the activation-session COOKIE secret (never of the invitation token, which lives in admin_invitations).
 token_digest char(64) NOT NULL UNIQUE CHECK (token_digest ~ '^[0-9a-f]{64}$'),
 csrf_nonce bytea NOT NULL CHECK (octet_length(csrf_nonce) = 32),
 csrf_key_id varchar(64) NOT NULL CHECK (csrf_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 status varchar(16) NOT NULL CHECK (status IN ('STARTED','OTP_VERIFIED','PASSWORD_SET','TOTP_ISSUED','COMPLETED','INVALIDATED')),
 invalidated_reason varchar(24) CHECK (invalidated_reason IN ('SUPERSEDED','INVITATION_CLOSED','PHONE_CONFLICT','ATTEMPTS_EXHAUSTED')),
 otp_verified_at timestamptz,
 password_hash text CHECK (password_hash ~ '^\$argon2id\$'),
 password_set_at timestamptz,
 totp_key_id varchar(64) CHECK (totp_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 totp_ciphertext bytea,
 totp_iv bytea,
 totp_tag bytea,
 totp_issued_at timestamptz,
 totp_attempt_count smallint NOT NULL DEFAULT 0 CHECK (totp_attempt_count BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 completed_at timestamptz,
 invalidated_at timestamptz,
 CONSTRAINT admin_activation_attempts_invitation_fk FOREIGN KEY (invitation_id, generation_id)
  REFERENCES app.admin_invitations (invitation_id, generation_id),
 CHECK (expires_at > created_at AND (expires_at - created_at) <= interval '1 hour'),
 -- F1: the sealed secret is all-or-nothing. Every column is tested with IS NULL / IS NOT NULL first, because
 -- octet_length(NULL) is NULL and a CHECK that evaluates to NULL PASSES: a bare length comparison would admit a NULL column.
 CONSTRAINT admin_activation_attempts_totp_all_or_none_ck CHECK (
     (totp_key_id IS NULL AND totp_ciphertext IS NULL AND totp_iv IS NULL AND totp_tag IS NULL AND totp_issued_at IS NULL)
  OR (totp_key_id IS NOT NULL AND totp_ciphertext IS NOT NULL AND totp_iv IS NOT NULL AND totp_tag IS NOT NULL
      AND totp_issued_at IS NOT NULL
      AND octet_length(totp_ciphertext) BETWEEN 1 AND 256 AND octet_length(totp_iv) = 12 AND octet_length(totp_tag) = 16)),
 CHECK (password_hash IS NULL OR password_set_at IS NOT NULL),
 -- password_hash and the TOTP secret exist only while the attempt is live; otp_verified_at / password_set_at stay as facts.
 CHECK ((status = 'STARTED'      AND otp_verified_at IS NULL     AND password_set_at IS NULL     AND password_hash IS NULL
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
         AND completed_at IS NULL AND invalidated_at IS NOT NULL AND invalidated_reason IS NOT NULL)),
 CHECK (totp_attempt_count < 5 OR (status = 'INVALIDATED' AND invalidated_reason = 'ATTEMPTS_EXHAUSTED')),
 CHECK (completed_at IS NULL OR completed_at >= created_at),
 CHECK (invalidated_at IS NULL OR invalidated_at >= created_at)
);
-- At most one live attempt per invitation (a new start replaces the old one) and at most one COMPLETED.
CREATE UNIQUE INDEX admin_activation_attempts_live_uq
 ON app.admin_activation_attempts (invitation_id) WHERE status NOT IN ('COMPLETED','INVALIDATED');
CREATE UNIQUE INDEX admin_activation_attempts_completed_uq
 ON app.admin_activation_attempts (invitation_id) WHERE status = 'COMPLETED';

CREATE FUNCTION app.admin_activation_attempt_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER admin_activation_attempt_transition_guard BEFORE UPDATE OR DELETE ON app.admin_activation_attempts
 FOR EACH ROW EXECUTE FUNCTION app.admin_activation_attempt_transition_guard();

CREATE TABLE app.admin_activation_otp_challenges (
 challenge_id uuid PRIMARY KEY,
 attempt_id uuid NOT NULL REFERENCES app.admin_activation_attempts (attempt_id),
 phone_normalized varchar(16) NOT NULL CHECK (phone_normalized ~ '^\+84[0-9]{9}$'),
 otp_digest char(64) NOT NULL CHECK (otp_digest ~ '^[0-9a-f]{64}$'),
 digest_key_id varchar(64) NOT NULL CHECK (digest_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 status varchar(16) NOT NULL CHECK (status IN ('PENDING_DELIVERY','PENDING','VERIFIED','LOCKED','INVALIDATED','DELIVERY_FAILED')),
 attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 resend_not_before timestamptz NOT NULL,
 verified_at timestamptz,
 ended_at timestamptz,
 CHECK (expires_at > created_at AND resend_not_before > created_at AND (expires_at - created_at) <= interval '10 minutes'),
 CHECK ((status IN ('PENDING_DELIVERY','PENDING') AND verified_at IS NULL AND ended_at IS NULL)
     OR (status = 'VERIFIED' AND verified_at IS NOT NULL AND ended_at IS NULL)
     OR (status IN ('LOCKED','INVALIDATED','DELIVERY_FAILED') AND verified_at IS NULL AND ended_at IS NOT NULL)),
 CHECK (attempt_count < 5 OR status = 'LOCKED'),
 CHECK (status <> 'LOCKED' OR attempt_count = 5),
 CHECK (verified_at IS NULL OR (verified_at >= created_at AND verified_at < expires_at)),
 CHECK (ended_at IS NULL OR ended_at >= created_at)
);
-- Exactly one challenge of an attempt can be live (delivered or being delivered).
CREATE UNIQUE INDEX admin_activation_otp_challenges_live_uq
 ON app.admin_activation_otp_challenges (attempt_id) WHERE status IN ('PENDING_DELIVERY','PENDING');
CREATE INDEX admin_activation_otp_challenges_attempt_idx
 ON app.admin_activation_otp_challenges (attempt_id, created_at DESC);

CREATE FUNCTION app.admin_activation_otp_challenge_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'admin activation otp challenge deletion forbidden' USING ERRCODE = '23001';
 END IF;
 IF ROW(NEW.challenge_id,NEW.attempt_id,NEW.phone_normalized,NEW.otp_digest,NEW.digest_key_id,NEW.created_at,NEW.expires_at,NEW.resend_not_before)
  IS DISTINCT FROM
    ROW(OLD.challenge_id,OLD.attempt_id,OLD.phone_normalized,OLD.otp_digest,OLD.digest_key_id,OLD.created_at,OLD.expires_at,OLD.resend_not_before) THEN
  RAISE EXCEPTION 'admin activation otp challenge identity immutable' USING ERRCODE = '23001';
 END IF;
 IF OLD.status IN ('VERIFIED','LOCKED','INVALIDATED','DELIVERY_FAILED') THEN
  RAISE EXCEPTION 'admin activation otp challenge is terminal' USING ERRCODE = '23001';
 END IF;
 IF OLD.status = 'PENDING_DELIVERY' AND NEW.status IN ('PENDING','DELIVERY_FAILED','INVALIDATED') AND NEW.attempt_count = OLD.attempt_count THEN
  RETURN NEW;
 END IF;
 IF OLD.status = 'PENDING' THEN
  IF NEW.status = 'PENDING' AND NEW.attempt_count = OLD.attempt_count + 1 AND NEW.attempt_count < 5 THEN RETURN NEW; END IF;
  IF NEW.status = 'LOCKED' AND NEW.attempt_count = OLD.attempt_count + 1 AND NEW.attempt_count = 5 THEN RETURN NEW; END IF;
  IF NEW.status IN ('VERIFIED','INVALIDATED') AND NEW.attempt_count = OLD.attempt_count THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'invalid admin activation otp challenge transition' USING ERRCODE = '23001';
END $$;
CREATE TRIGGER admin_activation_otp_challenge_transition_guard BEFORE UPDATE OR DELETE ON app.admin_activation_otp_challenges
 FOR EACH ROW EXECUTE FUNCTION app.admin_activation_otp_challenge_transition_guard();

-- The administrator that exists after COMPLETED. SYSTEM (operator bootstrap) has no profile row.
CREATE TABLE app.admin_profiles (
 user_id uuid PRIMARY KEY REFERENCES app.admin_memberships (user_id),
 invitation_id uuid NOT NULL UNIQUE REFERENCES app.admin_invitations (invitation_id),
 full_name varchar(120) NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 120),
 note varchar(1000),
 phone_verified_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL
);
CREATE TABLE app.admin_app_permissions (
 user_id uuid NOT NULL REFERENCES app.admin_memberships (user_id),
 app varchar(16) NOT NULL CHECK (app IN ('CUSTOMER','SHOP','DRIVER')),
 can_view boolean NOT NULL,
 can_review_profile boolean NOT NULL,
 can_lock boolean NOT NULL,
 PRIMARY KEY (user_id, app),
 CHECK (NOT can_review_profile OR can_view),
 CHECK (NOT can_lock OR can_view),
 CHECK (app <> 'CUSTOMER' OR NOT can_review_profile)
);
-- A profile is only valid together with at least one VIEW permission, checked at COMMIT (the permissions are inserted after it).
CREATE FUNCTION app.admin_profile_requires_view() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM app.admin_app_permissions WHERE user_id = NEW.user_id AND can_view) THEN
  RAISE EXCEPTION 'admin profile requires a VIEW permission' USING ERRCODE = '23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER admin_profile_requires_view AFTER INSERT ON app.admin_profiles
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.admin_profile_requires_view();

-- Down Migration
DROP TRIGGER admin_profile_requires_view ON app.admin_profiles;
DROP FUNCTION app.admin_profile_requires_view();
DROP TABLE app.admin_app_permissions;
DROP TABLE app.admin_profiles;
DROP TRIGGER admin_activation_otp_challenge_transition_guard ON app.admin_activation_otp_challenges;
DROP FUNCTION app.admin_activation_otp_challenge_transition_guard();
DROP TABLE app.admin_activation_otp_challenges;
DROP TRIGGER admin_activation_attempt_transition_guard ON app.admin_activation_attempts;
DROP FUNCTION app.admin_activation_attempt_transition_guard();
DROP TABLE app.admin_activation_attempts;
