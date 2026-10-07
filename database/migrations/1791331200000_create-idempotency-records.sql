-- Up Migration
-- M00-C1A1: app.idempotency_records (ADR-003 section 6 and 13.4). Idempotency registry only: no
-- audit_logs, no outbox_events, no Auth/users/sessions/proof tables.
--
-- The table never holds a plaintext request, token, password, OTP, proof or access token. A replayable
-- response is stored only as AES-256-GCM ciphertext + IV + tag; the request is stored only as an
-- HMAC-SHA-256 fingerprint (hex) plus the id of the key version that produced it.
CREATE TABLE app.idempotency_records (
  record_id uuid NOT NULL,

  -- Exact logical identity (scope_type, scope_id, operation_id, idempotency_key). All NOT NULL and
  -- length-bounded: a UNIQUE constraint alone would let NULLs through.
  scope_type varchar(64) NOT NULL,
  scope_id varchar(128) NOT NULL,
  operation_id varchar(128) NOT NULL,
  idempotency_key varchar(36) NOT NULL,

  request_fingerprint char(64) NOT NULL,
  crypto_key_id varchar(64) NOT NULL,
  response_status smallint NOT NULL,
  replay_format_version smallint NOT NULL,
  -- Small non-secret identifiers used by the replay authorization hook (ADR-003 section 4.3).
  replay_guard jsonb NOT NULL,

  -- Cleanup phase 1 clears all three together and keeps the row as a tombstone.
  replay_ciphertext bytea,
  replay_iv bytea,
  replay_tag bytea,

  created_at timestamptz NOT NULL,
  replay_expires_at timestamptz NOT NULL,
  dedupe_expires_at timestamptz NOT NULL,

  CONSTRAINT idempotency_records_pkey PRIMARY KEY (record_id),

  -- The UNIQUE tuple is what makes a lock-hash collision harmless: correctness never depends on the
  -- advisory lock, only on this exact key.
  CONSTRAINT idempotency_records_scope_key_uq
    UNIQUE (scope_type, scope_id, operation_id, idempotency_key),

  CONSTRAINT idempotency_records_identity_bounds_ck CHECK (
    char_length(scope_type) >= 1
    AND char_length(scope_id) >= 1
    AND char_length(operation_id) >= 1
  ),
  -- Canonical lowercase UUID, never the nil UUID.
  CONSTRAINT idempotency_records_key_format_ck CHECK (
    idempotency_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND idempotency_key <> '00000000-0000-0000-0000-000000000000'
  ),
  CONSTRAINT idempotency_records_fingerprint_ck CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT idempotency_records_key_id_ck CHECK (crypto_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- Only a committed 2xx success is ever persisted in C1.
  CONSTRAINT idempotency_records_status_ck CHECK (response_status BETWEEN 200 AND 299),
  CONSTRAINT idempotency_records_format_ck CHECK (replay_format_version = 1),
  -- The guard is a JSON object of identifiers. The size cap is deliberately looser than the 4 KiB
  -- application cap (jsonb text adds spaces); the application enforces the exact canonical cap.
  CONSTRAINT idempotency_records_guard_ck CHECK (
    jsonb_typeof(replay_guard) = 'object' AND octet_length(replay_guard::text) <= 16384
  ),

  -- Ciphertext, IV and tag are all NULL (tombstone) or all present, with fixed IV/tag lengths.
  CONSTRAINT idempotency_records_replay_all_or_none_ck CHECK (
    (replay_ciphertext IS NULL AND replay_iv IS NULL AND replay_tag IS NULL)
    OR (replay_ciphertext IS NOT NULL AND replay_iv IS NOT NULL AND replay_tag IS NOT NULL)
  ),
  CONSTRAINT idempotency_records_iv_length_ck CHECK (replay_iv IS NULL OR octet_length(replay_iv) = 12),
  CONSTRAINT idempotency_records_tag_length_ck CHECK (replay_tag IS NULL OR octet_length(replay_tag) = 16),
  CONSTRAINT idempotency_records_ciphertext_size_ck CHECK (
    replay_ciphertext IS NULL OR octet_length(replay_ciphertext) BETWEEN 1 AND 65536
  ),

  -- Expiry instants are persisted at millisecond precision, so the epoch milliseconds that the
  -- application binds into the AAD at encrypt time are exactly what it reads back at decrypt time.
  CONSTRAINT idempotency_records_ms_precision_ck CHECK (
    date_trunc('milliseconds', created_at) = created_at
    AND date_trunc('milliseconds', replay_expires_at) = replay_expires_at
    AND date_trunc('milliseconds', dedupe_expires_at) = dedupe_expires_at
  ),
  -- 1s <= replay TTL <= dedupe TTL <= 604800s (7 days).
  CONSTRAINT idempotency_records_ttl_ck CHECK (
    replay_expires_at >= created_at + interval '1 second'
    AND replay_expires_at <= dedupe_expires_at
    AND dedupe_expires_at <= created_at + interval '604800 seconds'
  )
);

-- Cleanup phase 1 (null replay material of rows past the replay TTL) and phase 2 (delete rows past the
-- dedupe TTL) claim rows by expiry; the first index is partial so it shrinks as tombstones appear.
CREATE INDEX idempotency_records_replay_cleanup_idx
  ON app.idempotency_records (replay_expires_at)
  WHERE replay_ciphertext IS NOT NULL;

CREATE INDEX idempotency_records_dedupe_cleanup_idx
  ON app.idempotency_records (dedupe_expires_at);

-- Down Migration
-- Only for disposable test or experimental databases. No CASCADE, no IF EXISTS: it fails loudly if the
-- table is missing instead of hiding drift.
DROP TABLE app.idempotency_records;
