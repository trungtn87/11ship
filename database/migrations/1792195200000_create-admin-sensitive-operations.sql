-- Up Migration
-- M01-D-ADMIN-1B: step-up confirmations of the SYSTEM administrator (create / reissue / revoke an ADMIN invitation).
-- Table, constraints and one trigger only: no seed data. The statements are the DDL reviewed in
-- docs/tasks/M01-D-ADMIN-1B-technical-contract.md section 5 (contract v2.1, approved for implementation); only this
-- header and the Down Migration are added. It references app.admin_memberships and app.admin_sessions (M01-D-LOGIN,
-- PR #34) and app.admin_invitations (M01-D-ADMIN-1A, PR #37), so it must not be applied before them.
--
-- Rules the schema enforces:
--  * stored status PENDING -> VERIFIED -> CONSUMED, or PENDING|VERIFIED -> INVALIDATED (REPLACED | ATTEMPTS_EXHAUSTED);
--  * an operation lives at most 120 seconds from its creation and is never extended; expiry is NOT stored, it is
--    decided with the database clock read after the last lock of each transaction;
--  * attempt_count only moves +1 while PENDING; the fifth wrong code INVALIDATES the row in the same UPDATE;
--  * identity columns and terminal rows are immutable; rows are never deleted;
--  * at most ONE live (PENDING|VERIFIED) operation per SYSTEM user. This unique index is a safety net only: the
--    coordinator serializes every create-operation on the user and membership row locks and invalidates the old live
--    row before it inserts the new one, so ordinary traffic never reaches it.
--
-- No IF [NOT] EXISTS and no CASCADE: if any object already exists the migration fails as a whole instead of hiding drift.

CREATE TABLE app.admin_sensitive_operations (
 operation_id uuid PRIMARY KEY,
 actor_user_id uuid NOT NULL REFERENCES app.admin_memberships(user_id),
 actor_session_id uuid NOT NULL REFERENCES app.admin_sessions(session_id),
 factor_id uuid NOT NULL,
 factor_version bigint NOT NULL CHECK (factor_version >= 1),
 membership_version bigint NOT NULL CHECK (membership_version >= 1),
 action varchar(24) NOT NULL CHECK (action IN ('CREATE_INVITATION','REISSUE_INVITATION','REVOKE_INVITATION')),
 target_id uuid REFERENCES app.admin_invitations(invitation_id),
 expected_version bigint CHECK (expected_version >= 1),
 payload_fingerprint char(64) NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
 fingerprint_key_id varchar(64) NOT NULL CHECK (fingerprint_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 status varchar(16) NOT NULL CHECK (status IN ('PENDING','VERIFIED','CONSUMED','INVALIDATED')),
 attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 verified_at timestamptz,
 consumed_at timestamptz,
 invalidated_at timestamptz,
 invalidated_reason varchar(24) CHECK (invalidated_reason IN ('REPLACED','ATTEMPTS_EXHAUSTED')),
 CHECK (expires_at > created_at AND (expires_at - created_at) <= interval '120 seconds'),
 CHECK ((action = 'CREATE_INVITATION' AND target_id IS NULL AND expected_version IS NULL)
     OR (action <> 'CREATE_INVITATION' AND target_id IS NOT NULL AND expected_version IS NOT NULL)),
 CHECK ((status = 'PENDING'     AND verified_at IS NULL     AND consumed_at IS NULL     AND invalidated_at IS NULL     AND invalidated_reason IS NULL)
     OR (status = 'VERIFIED'    AND verified_at IS NOT NULL AND consumed_at IS NULL     AND invalidated_at IS NULL     AND invalidated_reason IS NULL)
     OR (status = 'CONSUMED'    AND verified_at IS NOT NULL AND consumed_at IS NOT NULL AND invalidated_at IS NULL     AND invalidated_reason IS NULL)
     OR (status = 'INVALIDATED' AND consumed_at IS NULL     AND invalidated_at IS NOT NULL AND invalidated_reason IS NOT NULL)),
 CHECK (verified_at IS NULL OR (verified_at >= created_at AND verified_at < expires_at)),
 CHECK (consumed_at IS NULL OR (consumed_at >= verified_at AND consumed_at < expires_at)),
 CHECK (invalidated_at IS NULL OR invalidated_at >= created_at),
 CHECK (attempt_count < 5 OR (status = 'INVALIDATED' AND invalidated_reason = 'ATTEMPTS_EXHAUSTED'))
);
CREATE UNIQUE INDEX admin_sensitive_operations_live_uq
 ON app.admin_sensitive_operations(actor_user_id) WHERE status IN ('PENDING','VERIFIED');

CREATE FUNCTION app.admin_sensitive_operation_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'admin sensitive operation deletion forbidden' USING ERRCODE = '23001';
 END IF;
 IF ROW(NEW.operation_id,NEW.actor_user_id,NEW.actor_session_id,NEW.factor_id,NEW.factor_version,NEW.membership_version,
        NEW.action,NEW.target_id,NEW.expected_version,NEW.payload_fingerprint,NEW.fingerprint_key_id,NEW.created_at,NEW.expires_at)
  IS DISTINCT FROM
    ROW(OLD.operation_id,OLD.actor_user_id,OLD.actor_session_id,OLD.factor_id,OLD.factor_version,OLD.membership_version,
        OLD.action,OLD.target_id,OLD.expected_version,OLD.payload_fingerprint,OLD.fingerprint_key_id,OLD.created_at,OLD.expires_at) THEN
  RAISE EXCEPTION 'admin sensitive operation identity immutable' USING ERRCODE = '23001';
 END IF;
 IF OLD.status IN ('CONSUMED','INVALIDATED') THEN
  RAISE EXCEPTION 'admin sensitive operation is terminal' USING ERRCODE = '23001';
 END IF;
 IF OLD.verified_at IS NOT NULL AND NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
  RAISE EXCEPTION 'admin sensitive operation verified_at immutable' USING ERRCODE = '23001';
 END IF;
 IF OLD.status = 'PENDING' AND NEW.status = 'PENDING' THEN
  IF NEW.attempt_count = OLD.attempt_count + 1 AND NEW.attempt_count < 5 THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'invalid admin sensitive operation transition' USING ERRCODE = '23001';
 END IF;
 IF OLD.status = 'PENDING' AND NEW.status = 'VERIFIED' AND NEW.attempt_count = OLD.attempt_count THEN RETURN NEW; END IF;
 IF OLD.status = 'VERIFIED' AND NEW.status = 'CONSUMED' AND NEW.attempt_count = OLD.attempt_count THEN RETURN NEW; END IF;
 IF NEW.status = 'INVALIDATED' THEN
  IF NEW.invalidated_reason = 'REPLACED' AND NEW.attempt_count = OLD.attempt_count THEN RETURN NEW; END IF;
  IF NEW.invalidated_reason = 'ATTEMPTS_EXHAUSTED' AND OLD.status = 'PENDING'
     AND NEW.attempt_count = OLD.attempt_count + 1 AND NEW.attempt_count = 5 THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'invalid admin sensitive operation transition' USING ERRCODE = '23001';
END $$;
CREATE TRIGGER admin_sensitive_operation_transition_guard BEFORE UPDATE OR DELETE ON app.admin_sensitive_operations
 FOR EACH ROW EXECUTE FUNCTION app.admin_sensitive_operation_transition_guard();

-- Down Migration
-- Only for disposable test databases; never run on the Owner or staging database. Reverse dependency order, no CASCADE
-- and no IF EXISTS: it fails loudly if anything is missing instead of hiding drift. It must run BEFORE the Down
-- Migrations of M01-D-ADMIN-1A and M01-D-LOGIN, whose tables this one references.
DROP TRIGGER admin_sensitive_operation_transition_guard ON app.admin_sensitive_operations;
DROP FUNCTION app.admin_sensitive_operation_transition_guard();
DROP INDEX app.admin_sensitive_operations_live_uq;
DROP TABLE app.admin_sensitive_operations;
