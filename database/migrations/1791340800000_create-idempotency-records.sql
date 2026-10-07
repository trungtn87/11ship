-- Up Migration
-- M00-C1A1: exact-key idempotency tombstone + encrypted replay payload.
CREATE TABLE app.idempotency_records (
  record_id uuid PRIMARY KEY,
  scope_type varchar(64) NOT NULL,
  scope_id varchar(256) NOT NULL,
  operation_id varchar(128) NOT NULL,
  idempotency_key uuid NOT NULL,
  request_fingerprint char(64) NOT NULL,
  crypto_key_id varchar(64) NOT NULL,
  response_status smallint NOT NULL,
  replay_format_version smallint NOT NULL,
  replay_guard jsonb NOT NULL,
  replay_ciphertext bytea,
  replay_iv bytea,
  replay_tag bytea,
  created_at timestamptz(3) NOT NULL,
  replay_expires_at timestamptz(3) NOT NULL,
  dedupe_expires_at timestamptz(3) NOT NULL,
  CONSTRAINT idempotency_records_exact_key_uk
    UNIQUE (scope_type, scope_id, operation_id, idempotency_key),
  CONSTRAINT idempotency_records_scope_type_ck CHECK (char_length(scope_type) BETWEEN 1 AND 64),
  CONSTRAINT idempotency_records_scope_id_ck CHECK (char_length(scope_id) BETWEEN 1 AND 256),
  CONSTRAINT idempotency_records_operation_id_ck CHECK (char_length(operation_id) BETWEEN 1 AND 128),
  CONSTRAINT idempotency_records_fingerprint_ck CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT idempotency_records_crypto_key_id_ck CHECK (
    char_length(crypto_key_id) BETWEEN 1 AND 64
    AND crypto_key_id ~ '^[A-Za-z0-9_-]+$'
  ),
  CONSTRAINT idempotency_records_status_ck CHECK (response_status BETWEEN 200 AND 299),
  CONSTRAINT idempotency_records_format_ck CHECK (replay_format_version = 1),
  CONSTRAINT idempotency_records_ttl_ck CHECK (
    created_at <= replay_expires_at AND replay_expires_at <= dedupe_expires_at
  ),
  CONSTRAINT idempotency_records_replay_fields_ck CHECK (
    (replay_ciphertext IS NULL AND replay_iv IS NULL AND replay_tag IS NULL)
    OR
    (
      replay_ciphertext IS NOT NULL
      AND replay_iv IS NOT NULL
      AND replay_tag IS NOT NULL
      AND octet_length(replay_iv) = 12
      AND octet_length(replay_tag) = 16
    )
  )
);

CREATE INDEX idempotency_records_replay_cleanup_idx
  ON app.idempotency_records (replay_expires_at, record_id)
  WHERE replay_ciphertext IS NOT NULL;

CREATE INDEX idempotency_records_dedupe_cleanup_idx
  ON app.idempotency_records (dedupe_expires_at, record_id);

-- Down Migration
DROP TABLE app.idempotency_records;
