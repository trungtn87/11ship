-- Up Migration
-- M00-C1B: app.audit_logs and app.outbox_events (ADR-003 sections 7, 8, 9, 13.5, 13.6). Write-side schema
-- only: the audit log is append-only, the outbox table carries the full delivery state that the C1C
-- dispatcher will use, but nothing in C1B ever changes that state. No Auth/users/sessions/proof tables.
--
-- No IF [NOT] EXISTS anywhere: if any of these objects already exists the migration must fail (and be
-- rolled back as a whole, with no history row) instead of hiding schema drift.

-- ---------------------------------------------------------------------------------------------------
-- app.audit_logs
-- ---------------------------------------------------------------------------------------------------
-- One row per audited action. SUCCESS rows are written in the business transaction; DENIED and FAILURE
-- rows are written by a short standalone transaction (best effort). Rows are NEVER updated or deleted.
CREATE TABLE app.audit_logs (
  audit_id uuid NOT NULL,
  -- PostgreSQL clock at INSERT time (never an application clock), millisecond precision.
  occurred_at timestamptz(3) NOT NULL,
  -- Server-generated request id of the request context (never a raw client header).
  request_id uuid NOT NULL,

  -- Server-derived actor. actor_type is a bounded UPPER_SNAKE token (ANONYMOUS, USER, ADMIN, SYSTEM, ...);
  -- which tokens exist is decided by the modules that audit, not here. actor_id is NULL for pre-auth and
  -- anonymous denials.
  actor_type varchar(32) NOT NULL,
  actor_id varchar(128),

  -- Stable, versioned command name such as auth.register.v1 (dotted lower-case segments). A URL or path
  -- can never match.
  action varchar(128) NOT NULL,

  -- Resource touched by the action. All three are NULL when the action created or touched no resource.
  resource_type varchar(64),
  resource_id varchar(128),
  resource_version bigint,

  outcome varchar(16) NOT NULL,
  -- Short stable code, never a raw exception message. Mandatory unless the outcome is SUCCESS.
  reason_code varchar(64),

  -- Small safe JSON object. The application rejects (never truncates) invalid, secret-looking or
  -- oversized metadata before the INSERT; the size bound here is only a loose backstop (jsonb text adds
  -- spaces, the exact 8 KiB canonical cap is enforced by the application).
  metadata jsonb NOT NULL,

  CONSTRAINT audit_logs_pkey PRIMARY KEY (audit_id),

  CONSTRAINT audit_logs_actor_type_ck CHECK (actor_type ~ '^[A-Z][A-Z0-9_]{0,31}$'),
  CONSTRAINT audit_logs_actor_id_ck CHECK (actor_id IS NULL OR actor_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT audit_logs_action_ck CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,7}$'),
  CONSTRAINT audit_logs_resource_type_ck CHECK (
    resource_type IS NULL OR resource_type ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  CONSTRAINT audit_logs_resource_id_ck CHECK (
    resource_id IS NULL OR resource_id ~ '^[A-Za-z0-9._:-]{1,128}$'
  ),
  CONSTRAINT audit_logs_resource_version_ck CHECK (resource_version IS NULL OR resource_version >= 1),
  -- A resource id or version without a resource type is meaningless, and so is a version without an id.
  CONSTRAINT audit_logs_resource_shape_ck CHECK (
    (resource_type IS NOT NULL OR (resource_id IS NULL AND resource_version IS NULL))
    AND (resource_version IS NULL OR resource_id IS NOT NULL)
  ),
  CONSTRAINT audit_logs_outcome_ck CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILURE')),
  CONSTRAINT audit_logs_reason_code_ck CHECK (
    reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  CONSTRAINT audit_logs_reason_required_ck CHECK (outcome = 'SUCCESS' OR reason_code IS NOT NULL),
  CONSTRAINT audit_logs_metadata_ck CHECK (
    jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 32768
  )
);

-- Append-only at the database level (ADR-003 13.5). One STATEMENT-level trigger for the three mutating
-- operations: it fires even when a statement would touch zero rows, and it is the only kind of trigger
-- PostgreSQL allows for TRUNCATE. The function lives in schema app and has no privileges of its own.
-- A superuser or the table owner can still disable the trigger; production role provisioning (the
-- application role gets neither DDL nor trigger-disable rights) belongs to the deployment runbook.
CREATE FUNCTION app.audit_logs_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'app.audit_logs is append-only (% rejected)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON app.audit_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION app.audit_logs_reject_mutation();

-- ---------------------------------------------------------------------------------------------------
-- app.outbox_events
-- ---------------------------------------------------------------------------------------------------
-- Business events written in the same transaction as the mutation (write path, C1B) and delivered
-- at-least-once by the dispatcher (C1C). The delivery columns and their consistency rules are created
-- now so that C1C needs no schema change for the basic delivery state; C1B only ever inserts the
-- initial PENDING state.
CREATE TABLE app.outbox_events (
  event_id uuid NOT NULL,
  -- Immutable business envelope.
  event_type varchar(128) NOT NULL,
  event_schema_version smallint NOT NULL,
  resource_type varchar(64) NOT NULL,
  resource_id varchar(128) NOT NULL,
  resource_version bigint NOT NULL,
  -- PostgreSQL clock at INSERT time, millisecond precision.
  occurred_at timestamptz(3) NOT NULL,
  payload jsonb NOT NULL,

  -- Delivery state (ADR-003 13.6). C1B writes PENDING / 0 / available_at = occurred_at / NULLs only.
  status varchar(16) NOT NULL,
  attempt_count integer NOT NULL,
  available_at timestamptz(3) NOT NULL,
  locked_at timestamptz(3),
  lock_token uuid,
  published_at timestamptz(3),
  last_error_code varchar(64),

  CONSTRAINT outbox_events_pkey PRIMARY KEY (event_id),

  CONSTRAINT outbox_events_event_type_ck CHECK (
    event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,7}$'
  ),
  CONSTRAINT outbox_events_schema_version_ck CHECK (event_schema_version >= 1),
  CONSTRAINT outbox_events_resource_type_ck CHECK (resource_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT outbox_events_resource_id_ck CHECK (resource_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT outbox_events_resource_version_ck CHECK (resource_version >= 1),
  CONSTRAINT outbox_events_payload_ck CHECK (
    jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 262144
  ),

  CONSTRAINT outbox_events_status_ck CHECK (status IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'DEAD')),
  CONSTRAINT outbox_events_attempt_count_ck CHECK (attempt_count >= 0),
  -- A lease is a (locked_at, lock_token) pair that exists exactly while the event is PROCESSING.
  CONSTRAINT outbox_events_lease_ck CHECK (
    (locked_at IS NULL) = (lock_token IS NULL)
    AND ((status = 'PROCESSING') = (locked_at IS NOT NULL))
  ),
  -- published_at exists exactly for PUBLISHED events.
  CONSTRAINT outbox_events_published_ck CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL)),
  -- Nothing can be available, locked or published before the event occurred.
  CONSTRAINT outbox_events_time_order_ck CHECK (
    available_at >= occurred_at
    AND (locked_at IS NULL OR locked_at >= occurred_at)
    AND (published_at IS NULL OR published_at >= occurred_at)
  ),
  CONSTRAINT outbox_events_last_error_code_ck CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
  )
  -- Deliberately NO unique constraint on (resource_id, resource_version): one resource version can
  -- legitimately produce several events of different types.
);

-- Dispatcher claim of due PENDING events, oldest first (C1C).
CREATE INDEX outbox_events_pending_claim_idx
  ON app.outbox_events (available_at, event_id)
  WHERE status = 'PENDING';

-- Dispatcher reclaim of PROCESSING events whose lease went stale (C1C).
CREATE INDEX outbox_events_processing_reclaim_idx
  ON app.outbox_events (locked_at, event_id)
  WHERE status = 'PROCESSING';

-- Down Migration
-- Only for disposable test or experimental databases. Dependency order: trigger, then its function,
-- then the tables. No CASCADE and no IF EXISTS: it fails loudly if anything is missing instead of
-- hiding drift.
DROP TRIGGER audit_logs_append_only ON app.audit_logs;
DROP FUNCTION app.audit_logs_reject_mutation();
DROP TABLE app.outbox_events;
DROP TABLE app.audit_logs;
