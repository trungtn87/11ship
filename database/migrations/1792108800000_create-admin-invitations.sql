-- Up Migration
-- M01-D-ADMIN-1A: storage of ADMIN invitations and their permission snapshots. Tables, constraints and triggers only:
-- no seed data, no route, no activation. The SQL below is the reviewed design artifact
-- 01-Technical/01-schema-design.sql of "11Ship-Admin-Design-Handoff-v2" (statements unchanged; only this header and
-- the Down Migration are added). It references app.users (Auth Core) and app.admin_memberships (M01-D-LOGIN, PR #34),
-- so this migration is stacked on that schema and must not be applied before it.
--
-- Invariants (technical corrections 1 and 2 of the 1A task):
--  * Reissue order: the coordinator locks the phone, moves the OLD invitation to SUPERSEDED with successor_id set, and
--    only then INSERTs the successor PENDING. successor_id is DEFERRABLE INITIALLY DEFERRED, so the old row may point at
--    a successor that is inserted later in the same transaction. A successor PENDING is never inserted first.
--  * Snapshot sealing: permissions may only be inserted while snapshot_sealed = false (the insert trigger locks the
--    invitation row first); the coordinator then seals once (false -> true, PENDING only, version unchanged). Terminal
--    transitions require a sealed snapshot, and the deferred constraint trigger forces sealed = true plus at least one
--    VIEW permission at COMMIT. Permissions can never be updated or deleted.
-- An expired but not yet terminal invitation still occupies the pending-phone unique index (no now() in the predicate).
--
-- No IF [NOT] EXISTS and no CASCADE: if any object already exists the migration fails as a whole instead of hiding drift.

CREATE TABLE app.admin_invitations (
 invitation_id uuid PRIMARY KEY,
 generation_id uuid NOT NULL UNIQUE,
 phone_normalized varchar(16) NOT NULL CHECK (phone_normalized ~ '^\+84[0-9]{9}$'),
 full_name varchar(120) NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 120),
 note varchar(1000),
 token_digest char(64) NOT NULL UNIQUE CHECK (token_digest ~ '^[0-9a-f]{64}$'),
 status varchar(24) NOT NULL CHECK (status IN ('PENDING','ACCEPTED','REVOKED','SUPERSEDED','EXPIRED','PHONE_CONFLICT')),
 version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_by uuid NOT NULL REFERENCES app.admin_memberships(user_id),
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 terminal_at timestamptz,
 accepted_user_id uuid REFERENCES app.users(user_id),
 successor_id uuid REFERENCES app.admin_invitations(invitation_id) DEFERRABLE INITIALLY DEFERRED,
 snapshot_sealed boolean NOT NULL DEFAULT false,
 UNIQUE (invitation_id,generation_id),
 CHECK (expires_at > created_at),
 CHECK (terminal_at IS NULL OR terminal_at >= created_at),
 CHECK (
  (status='PENDING' AND terminal_at IS NULL AND accepted_user_id IS NULL)
  OR (status='ACCEPTED' AND terminal_at IS NOT NULL AND accepted_user_id IS NOT NULL)
  OR (status IN ('REVOKED','SUPERSEDED','EXPIRED','PHONE_CONFLICT') AND terminal_at IS NOT NULL AND accepted_user_id IS NULL)
 ),
 CHECK ((status='SUPERSEDED' AND successor_id IS NOT NULL AND successor_id <> invitation_id)
  OR (status <> 'SUPERSEDED' AND successor_id IS NULL))
);
CREATE UNIQUE INDEX admin_invitations_pending_phone_uq ON app.admin_invitations(phone_normalized) WHERE status='PENDING';
CREATE INDEX admin_invitations_list_idx ON app.admin_invitations(created_at DESC,invitation_id DESC);
CREATE TABLE app.admin_invitation_permissions (
 invitation_id uuid NOT NULL REFERENCES app.admin_invitations(invitation_id),
 app varchar(16) NOT NULL CHECK (app IN ('CUSTOMER','SHOP','DRIVER')),
 can_view boolean NOT NULL,
 can_review_profile boolean NOT NULL,
 can_lock boolean NOT NULL,
 PRIMARY KEY(invitation_id,app),
 CHECK (NOT can_review_profile OR can_view),
 CHECK (NOT can_lock OR can_view),
 CHECK (app <> 'CUSTOMER' OR NOT can_review_profile)
);
-- Permanent anti-cycle/terminal identity protection. Permission snapshot immutability is enforced below.
CREATE FUNCTION app.admin_invitation_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'admin invitation deletion forbidden' USING ERRCODE='23001';
 END IF;
 IF ROW(NEW.invitation_id,NEW.generation_id,NEW.phone_normalized,NEW.full_name,NEW.note,NEW.token_digest,NEW.created_by,NEW.created_at,NEW.expires_at)
  IS DISTINCT FROM ROW(OLD.invitation_id,OLD.generation_id,OLD.phone_normalized,OLD.full_name,OLD.note,OLD.token_digest,OLD.created_by,OLD.created_at,OLD.expires_at) THEN
  RAISE EXCEPTION 'admin invitation identity immutable' USING ERRCODE='23001';
 END IF;
 IF OLD.status='PENDING' AND NEW.status='PENDING' AND NOT OLD.snapshot_sealed AND NEW.snapshot_sealed
  AND NEW.version=OLD.version AND ROW(NEW.terminal_at,NEW.accepted_user_id,NEW.successor_id) IS NOT DISTINCT FROM ROW(OLD.terminal_at,OLD.accepted_user_id,OLD.successor_id) THEN
  RETURN NEW;
 END IF;
 IF NOT OLD.snapshot_sealed OR NOT NEW.snapshot_sealed OR OLD.status <> 'PENDING' OR NEW.status='PENDING' OR NEW.version <> OLD.version+1 THEN
  RAISE EXCEPTION 'invalid admin invitation transition' USING ERRCODE='23001';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER admin_invitation_transition_guard BEFORE UPDATE OR DELETE ON app.admin_invitations FOR EACH ROW EXECUTE FUNCTION app.admin_invitation_transition_guard();
CREATE FUNCTION app.admin_invitation_permissions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'admin invitation permissions immutable' USING ERRCODE='23001';
END $$;
CREATE TRIGGER admin_invitation_permissions_immutable BEFORE UPDATE OR DELETE ON app.admin_invitation_permissions FOR EACH ROW EXECUTE FUNCTION app.admin_invitation_permissions_immutable();
CREATE FUNCTION app.admin_invitation_permission_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_sealed boolean;
BEGIN
 SELECT snapshot_sealed INTO v_sealed FROM app.admin_invitations WHERE invitation_id=NEW.invitation_id FOR UPDATE;
 IF NOT FOUND OR v_sealed THEN
  RAISE EXCEPTION 'invitation permission snapshot sealed or absent' USING ERRCODE='23001';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER admin_invitation_permission_insert_guard BEFORE INSERT ON app.admin_invitation_permissions FOR EACH ROW EXECUTE FUNCTION app.admin_invitation_permission_insert_guard();
CREATE FUNCTION app.admin_invitation_requires_view() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
 v_id := NEW.invitation_id;
 IF EXISTS(SELECT 1 FROM app.admin_invitations WHERE invitation_id=v_id)
  AND (NOT EXISTS(SELECT 1 FROM app.admin_invitations WHERE invitation_id=v_id AND snapshot_sealed)
  OR NOT EXISTS(SELECT 1 FROM app.admin_invitation_permissions WHERE invitation_id=v_id AND can_view)) THEN
  RAISE EXCEPTION 'admin invitation requires VIEW scope' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER admin_invitation_requires_view AFTER INSERT ON app.admin_invitations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.admin_invitation_requires_view();

-- Down Migration
-- Only for disposable test databases; never run on the Owner or staging database. Reverse dependency order, no CASCADE
-- and no IF EXISTS: it fails loudly if anything is missing instead of hiding drift. It must run BEFORE the
-- M01-D-LOGIN down migration because these tables reference app.admin_memberships and app.users.
DROP TRIGGER admin_invitation_requires_view ON app.admin_invitations;
DROP FUNCTION app.admin_invitation_requires_view();
DROP TABLE app.admin_invitation_permissions;
DROP FUNCTION app.admin_invitation_permission_insert_guard();
DROP FUNCTION app.admin_invitation_permissions_immutable();
DROP TABLE app.admin_invitations;
DROP FUNCTION app.admin_invitation_transition_guard();
