-- Up Migration
-- M01-ANDROID: native device binding of the client session (Food / Ship Android apps).
-- Contract: docs/design/system-v2-20261011/11-m01-session-device-contract.md sections 7, 8 and 9. The seven tables below are
-- the shared owner of "which phone is this session on"; they hang the existing app.sessions off a binding through
-- client_session_bindings. There is no second session or account store.
--
-- Mapping to contract section 9 (deviations are deliberate and listed here, in the same words as the PR):
--   * client_device_challenges.nonce  stores the 32 random bytes themselves (contract: nonce_digest). The server must put the
--     nonce into the signed registration message and compare it with the attestation challenge of the certificate, so a
--     digest is not enough. The value is a public single-use challenge handed to the client in clear text, never a credential.
--   * client_device_keys.attestation_chain  (added) keeps the DER chain that was verified at enrolment. AUTH re-validates THAT
--     chain against the current roots / revocation snapshot (contract section 7: "original verified attestation provenance").
--   * client_device_key_links is keyed (binding_id, key_id) with a partial unique (binding_id, app) WHERE detached_at IS NULL,
--     instead of PRIMARY KEY (binding_id, app): a binding may replace the key of one app (that app was cleared and joined
--     again) while the detached history row is kept. The one-current-key-per-app-per-binding rule is the partial index.
--   * Every uuid reference to app.users is app.users (user_id).
--
-- Rules shared with every migration of this repository: no IF [NOT] EXISTS on DDL, no CASCADE, no seed data, and no GRANT
-- (runtime grants live in ops/runbooks/render-supabase-staging.md). Append-only: nothing earlier is edited.

CREATE TABLE app.client_device_keys (
  key_id            uuid          NOT NULL,
  public_key_spki   bytea         NOT NULL,
  app               varchar(4)    NOT NULL,
  signer_sha256     bytea         NOT NULL,
  package_name      varchar(200)  NOT NULL,
  attestation_level varchar(16)   NOT NULL,
  attestation_chain bytea[]       NOT NULL,
  verified_at       timestamptz   NOT NULL,
  revoked_at        timestamptz,
  CONSTRAINT client_device_keys_pkey PRIMARY KEY (key_id),
  CONSTRAINT client_device_keys_spki_uq UNIQUE (public_key_spki),
  CONSTRAINT client_device_keys_app_ck CHECK (app IN ('FOOD', 'SHIP')),
  CONSTRAINT client_device_keys_signer_ck CHECK (octet_length(signer_sha256) = 32),
  CONSTRAINT client_device_keys_package_ck CHECK (package_name ~ '^[A-Za-z][A-Za-z0-9_.]{0,199}$'),
  CONSTRAINT client_device_keys_level_ck CHECK (attestation_level IN ('TEE', 'STRONGBOX')),
  CONSTRAINT client_device_keys_chain_ck CHECK (cardinality(attestation_chain) BETWEEN 1 AND 8),
  CONSTRAINT client_device_keys_revoked_ck CHECK (revoked_at IS NULL OR revoked_at >= verified_at),
  -- target of the composite foreign keys below (a key belongs to exactly one app)
  CONSTRAINT client_device_keys_key_app_uq UNIQUE (key_id, app)
);

CREATE TABLE app.client_device_challenges (
  challenge_id uuid        NOT NULL,
  nonce        bytea       NOT NULL,
  app          varchar(4)  NOT NULL,
  purpose      varchar(8)  NOT NULL,
  key_id       uuid,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL,
  CONSTRAINT client_device_challenges_pkey PRIMARY KEY (challenge_id),
  CONSTRAINT client_device_challenges_nonce_uq UNIQUE (nonce),
  CONSTRAINT client_device_challenges_nonce_ck CHECK (octet_length(nonce) = 32),
  CONSTRAINT client_device_challenges_app_ck CHECK (app IN ('FOOD', 'SHIP')),
  CONSTRAINT client_device_challenges_purpose_ck CHECK (purpose IN ('ENROLL', 'JOIN', 'AUTH')),
  CONSTRAINT client_device_challenges_key_ck CHECK ((purpose = 'AUTH') = (key_id IS NOT NULL)),
  CONSTRAINT client_device_challenges_time_ck CHECK (expires_at > created_at AND (consumed_at IS NULL OR consumed_at >= created_at))
);
CREATE INDEX client_device_challenges_expiry_idx ON app.client_device_challenges (expires_at);

CREATE TABLE app.client_device_bindings (
  binding_id     uuid        NOT NULL,
  user_id        uuid        NOT NULL,
  generation     bigint      NOT NULL,
  activated_at   timestamptz NOT NULL,
  deactivated_at timestamptz,
  CONSTRAINT client_device_bindings_pkey PRIMARY KEY (binding_id),
  CONSTRAINT client_device_bindings_user_fk FOREIGN KEY (user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT client_device_bindings_generation_ck CHECK (generation BETWEEN 1 AND 9007199254740991),
  CONSTRAINT client_device_bindings_user_generation_uq UNIQUE (user_id, generation),
  CONSTRAINT client_device_bindings_time_ck CHECK (deactivated_at IS NULL OR deactivated_at >= activated_at),
  -- composite targets
  CONSTRAINT client_device_bindings_binding_user_uq UNIQUE (binding_id, user_id),
  CONSTRAINT client_device_bindings_binding_generation_uq UNIQUE (binding_id, generation)
);
-- One current binding per user.
CREATE UNIQUE INDEX client_device_bindings_current_uq ON app.client_device_bindings (user_id) WHERE deactivated_at IS NULL;

CREATE TABLE app.client_device_key_links (
  binding_id  uuid        NOT NULL,
  key_id      uuid        NOT NULL,
  user_id     uuid        NOT NULL,
  app         varchar(4)  NOT NULL,
  linked_at   timestamptz NOT NULL,
  detached_at timestamptz,
  CONSTRAINT client_device_key_links_pkey PRIMARY KEY (binding_id, key_id),
  CONSTRAINT client_device_key_links_binding_fk FOREIGN KEY (binding_id, user_id)
    REFERENCES app.client_device_bindings (binding_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT client_device_key_links_key_fk FOREIGN KEY (key_id, app)
    REFERENCES app.client_device_keys (key_id, app) ON DELETE RESTRICT,
  CONSTRAINT client_device_key_links_time_ck CHECK (detached_at IS NULL OR detached_at >= linked_at),
  -- target of the session binding foreign key
  CONSTRAINT client_device_key_links_triple_uq UNIQUE (binding_id, key_id, app)
);
-- A key is linked to one binding at a time; a binding has one current key per app.
CREATE UNIQUE INDEX client_device_key_links_key_current_uq ON app.client_device_key_links (key_id) WHERE detached_at IS NULL;
CREATE UNIQUE INDEX client_device_key_links_app_current_uq ON app.client_device_key_links (binding_id, app) WHERE detached_at IS NULL;

CREATE TABLE app.client_device_registration_grants (
  grant_id              uuid        NOT NULL,
  token_digest          bytea       NOT NULL,
  key_id                uuid        NOT NULL,
  join_binding_id       uuid,
  authorizer_key_id     uuid,
  expires_at            timestamptz NOT NULL,
  created_at            timestamptz NOT NULL,
  consumed_at           timestamptz,
  consumed_operation_id uuid,
  CONSTRAINT client_device_registration_grants_pkey PRIMARY KEY (grant_id),
  CONSTRAINT client_device_registration_grants_token_uq UNIQUE (token_digest),
  CONSTRAINT client_device_registration_grants_token_ck CHECK (octet_length(token_digest) = 32),
  CONSTRAINT client_device_registration_grants_key_fk FOREIGN KEY (key_id) REFERENCES app.client_device_keys (key_id) ON DELETE RESTRICT,
  CONSTRAINT client_device_registration_grants_binding_fk FOREIGN KEY (join_binding_id) REFERENCES app.client_device_bindings (binding_id) ON DELETE RESTRICT,
  CONSTRAINT client_device_registration_grants_authorizer_fk FOREIGN KEY (authorizer_key_id) REFERENCES app.client_device_keys (key_id) ON DELETE RESTRICT,
  CONSTRAINT client_device_registration_grants_join_ck CHECK ((join_binding_id IS NULL) = (authorizer_key_id IS NULL)),
  CONSTRAINT client_device_registration_grants_consumed_ck CHECK ((consumed_at IS NULL) = (consumed_operation_id IS NULL)),
  CONSTRAINT client_device_registration_grants_time_ck CHECK (expires_at > created_at)
);
CREATE INDEX client_device_registration_grants_expiry_idx ON app.client_device_registration_grants (expires_at);

CREATE TABLE app.client_session_bindings (
  session_id uuid        NOT NULL,
  binding_id uuid        NOT NULL,
  key_id     uuid        NOT NULL,
  app        varchar(4)  NOT NULL,
  generation bigint      NOT NULL,
  is_current boolean     NOT NULL,
  CONSTRAINT client_session_bindings_pkey PRIMARY KEY (session_id),
  CONSTRAINT client_session_bindings_session_fk FOREIGN KEY (session_id) REFERENCES app.sessions (session_id) ON DELETE RESTRICT,
  CONSTRAINT client_session_bindings_link_fk FOREIGN KEY (binding_id, key_id, app)
    REFERENCES app.client_device_key_links (binding_id, key_id, app) ON DELETE RESTRICT,
  CONSTRAINT client_session_bindings_generation_fk FOREIGN KEY (binding_id, generation)
    REFERENCES app.client_device_bindings (binding_id, generation) ON DELETE RESTRICT,
  CONSTRAINT client_session_bindings_app_ck CHECK (app IN ('FOOD', 'SHIP'))
);
CREATE UNIQUE INDEX client_session_bindings_current_uq ON app.client_session_bindings (binding_id, app) WHERE is_current;
CREATE INDEX client_session_bindings_binding_idx ON app.client_session_bindings (binding_id);

CREATE TABLE app.client_device_request_nonces (
  key_id       uuid        NOT NULL,
  nonce_digest bytea       NOT NULL,
  expires_at   timestamptz NOT NULL,
  CONSTRAINT client_device_request_nonces_pkey PRIMARY KEY (key_id, nonce_digest),
  CONSTRAINT client_device_request_nonces_key_fk FOREIGN KEY (key_id) REFERENCES app.client_device_keys (key_id) ON DELETE RESTRICT,
  CONSTRAINT client_device_request_nonces_digest_ck CHECK (octet_length(nonce_digest) = 32)
);
CREATE INDEX client_device_request_nonces_expiry_idx ON app.client_device_request_nonces (expires_at);

-- "Revoke session atomically sets is_current false" (contract section 9): whoever revokes a session (logout, replacement,
-- reset, role switch, expiry sweep) goes through app.sessions, so the rule lives next to the data instead of in every caller.
CREATE FUNCTION app.client_session_bindings_release() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  UPDATE app.client_session_bindings SET is_current = false WHERE session_id = NEW.session_id AND is_current;
  RETURN NEW;
END
$$;
CREATE TRIGGER sessions_release_binding_trg
  AFTER UPDATE OF revoked_at ON app.sessions
  FOR EACH ROW WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
  EXECUTE FUNCTION app.client_session_bindings_release();

-- The only mutable bits of the immutable tables: links change only detached_at; session bindings only is_current.
CREATE FUNCTION app.client_device_immutable_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'client_device_key_links' THEN
    IF NEW.binding_id IS DISTINCT FROM OLD.binding_id OR NEW.key_id IS DISTINCT FROM OLD.key_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.app IS DISTINCT FROM OLD.app
       OR NEW.linked_at IS DISTINCT FROM OLD.linked_at OR OLD.detached_at IS NOT NULL THEN
      RAISE EXCEPTION 'client_device_key_links: only detached_at may be set once';
    END IF;
  ELSIF TG_TABLE_NAME = 'client_session_bindings' THEN
    IF NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.binding_id IS DISTINCT FROM OLD.binding_id
       OR NEW.key_id IS DISTINCT FROM OLD.key_id OR NEW.app IS DISTINCT FROM OLD.app
       OR NEW.generation IS DISTINCT FROM OLD.generation OR (NEW.is_current AND NOT OLD.is_current) THEN
      RAISE EXCEPTION 'client_session_bindings: only is_current may be cleared';
    END IF;
  ELSIF TG_TABLE_NAME = 'client_device_bindings' THEN
    IF NEW.binding_id IS DISTINCT FROM OLD.binding_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.generation IS DISTINCT FROM OLD.generation OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
       OR OLD.deactivated_at IS NOT NULL THEN
      RAISE EXCEPTION 'client_device_bindings: only deactivated_at may be set once';
    END IF;
  ELSIF TG_TABLE_NAME = 'client_device_keys' THEN
    IF NEW.key_id IS DISTINCT FROM OLD.key_id OR NEW.public_key_spki IS DISTINCT FROM OLD.public_key_spki
       OR NEW.app IS DISTINCT FROM OLD.app OR NEW.signer_sha256 IS DISTINCT FROM OLD.signer_sha256
       OR NEW.package_name IS DISTINCT FROM OLD.package_name OR NEW.attestation_level IS DISTINCT FROM OLD.attestation_level
       OR NEW.attestation_chain IS DISTINCT FROM OLD.attestation_chain OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
       OR OLD.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'client_device_keys: only revoked_at may be set once';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER client_device_key_links_guard_trg BEFORE UPDATE ON app.client_device_key_links
  FOR EACH ROW EXECUTE FUNCTION app.client_device_immutable_guard();
CREATE TRIGGER client_session_bindings_guard_trg BEFORE UPDATE ON app.client_session_bindings
  FOR EACH ROW EXECUTE FUNCTION app.client_device_immutable_guard();
CREATE TRIGGER client_device_bindings_guard_trg BEFORE UPDATE ON app.client_device_bindings
  FOR EACH ROW EXECUTE FUNCTION app.client_device_immutable_guard();
CREATE TRIGGER client_device_keys_guard_trg BEFORE UPDATE ON app.client_device_keys
  FOR EACH ROW EXECUTE FUNCTION app.client_device_immutable_guard();

-- Down Migration
-- Only for disposable test or experimental databases. Reverse dependency order, no CASCADE, no IF EXISTS.
DROP TRIGGER sessions_release_binding_trg ON app.sessions;
DROP FUNCTION app.client_session_bindings_release();
DROP TABLE app.client_device_request_nonces;
DROP TABLE app.client_session_bindings;
DROP TABLE app.client_device_registration_grants;
DROP TABLE app.client_device_key_links;
DROP TABLE app.client_device_bindings;
DROP TABLE app.client_device_challenges;
DROP TABLE app.client_device_keys;
DROP FUNCTION app.client_device_immutable_guard();
