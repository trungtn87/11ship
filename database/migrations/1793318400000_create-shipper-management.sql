-- Up Migration
-- M03: Shipper management (profile review, bank account, activity switch, closure request, internal classification) and the
-- Shipper wallet parameters (minimum top-up / withdrawal per request). Docs: docs/current/M03-UI-LOCKED-2026-10-15.md.
--
-- Additive and safe: app.drivers keeps every column, constraint and row it has. New columns carry defaults or are nullable, existing
-- rows are backfilled by the statements below, no data is deleted and nothing is dropped. No CASCADE anywhere.
--
-- The driver `status` vocabulary (PENDING, ACTIVE, SUSPENDED, CLOSING, CLOSED) is unchanged. `review_state` describes the review of
-- the profile while the driver is PENDING (DRAFT -> SUBMITTED -> APPROVED | REJECTED -> SUBMITTED ...), and is APPROVED for every
-- other status. `driver_type` (EXTERNAL / PLATFORM) is an internal classification that only the administration web reads and writes.

-- ---------------------------------------------------------------------------------------------------
-- app.drivers: review, suspension and closure columns, human-readable Shipper code
-- ---------------------------------------------------------------------------------------------------
CREATE SEQUENCE app.driver_code_seq AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;

-- The runtime role gets no sequence privilege (the grant matrix has none): it reaches the sequence only through this function, which
-- runs with its owner's rights, exactly like app.purge_app_user. The runtime role gets EXECUTE in 03-runtime-function-grants.sql.
CREATE FUNCTION app.next_shipper_code() RETURNS varchar
  LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT 'SH' || lpad(nextval('app.driver_code_seq')::text, 6, '0')
$$;
REVOKE ALL ON FUNCTION app.next_shipper_code() FROM PUBLIC;

-- The default is evaluated per existing row, so every driver already stored gets its own code in creation order of the scan.
ALTER TABLE app.drivers
  ADD COLUMN shipper_code varchar(16) NOT NULL DEFAULT app.next_shipper_code(),
  ADD COLUMN review_state varchar(16) NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewed_by uuid,
  ADD COLUMN rejection_reason varchar(500),
  ADD COLUMN suspension_reason varchar(500),
  ADD COLUMN suspended_at timestamptz,
  ADD COLUMN status_before_closing varchar(16),
  ADD COLUMN closure_requested_at timestamptz,
  ADD COLUMN closure_note varchar(500);

-- Rows that exist today were created by self-onboarding (PENDING). Everything that is not PENDING can only have been approved.
UPDATE app.drivers SET review_state = 'APPROVED' WHERE status <> 'PENDING';

ALTER TABLE app.drivers
  ADD CONSTRAINT drivers_shipper_code_uq UNIQUE (shipper_code),
  ADD CONSTRAINT drivers_shipper_code_ck CHECK (shipper_code ~ '^SH[0-9]{6,12}$'),
  ADD CONSTRAINT drivers_reviewed_by_fk FOREIGN KEY (reviewed_by) REFERENCES app.users (user_id),
  ADD CONSTRAINT drivers_review_state_ck CHECK (review_state IN ('DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED')),
  ADD CONSTRAINT drivers_rejection_reason_ck CHECK (
    (review_state = 'REJECTED' AND rejection_reason IS NOT NULL AND length(btrim(rejection_reason)) >= 1)
    OR (review_state <> 'REJECTED' AND rejection_reason IS NULL)
  ),
  -- Only-when rules: a reason exists only on the state it explains. Presence on entry is the service's job (transitions go through
  -- it), so a direct status change by older tooling keeps working; for a driver whose status is not PENDING the review_state is not
  -- read (the status is the truth).
  ADD CONSTRAINT drivers_suspension_reason_ck CHECK (status = 'SUSPENDED' OR (suspension_reason IS NULL AND suspended_at IS NULL)),
  ADD CONSTRAINT drivers_status_before_closing_ck CHECK (status_before_closing IS NULL OR status_before_closing IN ('ACTIVE', 'SUSPENDED'));

CREATE INDEX drivers_status_idx ON app.drivers (status, created_at DESC);
CREATE INDEX drivers_full_name_idx ON app.drivers (lower(full_name));

-- ---------------------------------------------------------------------------------------------------
-- app.driver_bank_accounts: the one current bank account of a driver
-- ---------------------------------------------------------------------------------------------------
-- Any change of bank, account number or holder resets verification_state to UNVERIFIED (done by the service in the same
-- transaction; the CHECKs below keep a VERIFIED row coherent). The account number is personal data: it never goes to audit
-- metadata or outbox payloads.
CREATE TABLE app.driver_bank_accounts (
  driver_id uuid NOT NULL,
  bank_code varchar(16) NOT NULL,
  bank_name varchar(120) NOT NULL,
  account_number varchar(20) NOT NULL,
  account_holder varchar(120) NOT NULL,
  verification_state varchar(16) NOT NULL DEFAULT 'UNVERIFIED',
  verified_by uuid,
  verified_at timestamptz,
  rejection_reason varchar(500),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT driver_bank_accounts_pkey PRIMARY KEY (driver_id),
  CONSTRAINT driver_bank_accounts_driver_fk FOREIGN KEY (driver_id) REFERENCES app.drivers (driver_id),
  CONSTRAINT driver_bank_accounts_verified_by_fk FOREIGN KEY (verified_by) REFERENCES app.users (user_id),
  CONSTRAINT driver_bank_accounts_bank_code_ck CHECK (bank_code ~ '^[A-Z0-9]{2,16}$'),
  CONSTRAINT driver_bank_accounts_number_ck CHECK (account_number ~ '^[0-9]{6,20}$'),
  CONSTRAINT driver_bank_accounts_holder_ck CHECK (length(btrim(account_holder)) >= 1),
  CONSTRAINT driver_bank_accounts_state_ck CHECK (verification_state IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')),
  CONSTRAINT driver_bank_accounts_verified_ck CHECK (
    (verification_state = 'VERIFIED' AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND rejection_reason IS NULL)
    OR (verification_state = 'REJECTED' AND rejection_reason IS NOT NULL AND length(btrim(rejection_reason)) >= 1 AND verified_by IS NULL AND verified_at IS NULL)
    OR (verification_state = 'UNVERIFIED' AND rejection_reason IS NULL AND verified_by IS NULL AND verified_at IS NULL)
  ),
  CONSTRAINT driver_bank_accounts_time_order_ck CHECK (updated_at >= created_at)
);

-- ---------------------------------------------------------------------------------------------------
-- app.driver_events: transition history of a driver (who, when, what, why)
-- ---------------------------------------------------------------------------------------------------
-- Append-only. Complements app.audit_logs (platform audit) with a per-driver history the administration web can show.
CREATE TABLE app.driver_events (
  event_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  event_type varchar(48) NOT NULL,
  from_status varchar(16),
  to_status varchar(16),
  from_review_state varchar(16),
  to_review_state varchar(16),
  actor_type varchar(16) NOT NULL,
  actor_id uuid,
  reason varchar(500),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,

  CONSTRAINT driver_events_pkey PRIMARY KEY (event_id),
  CONSTRAINT driver_events_driver_fk FOREIGN KEY (driver_id) REFERENCES app.drivers (driver_id),
  CONSTRAINT driver_events_actor_fk FOREIGN KEY (actor_id) REFERENCES app.users (user_id),
  CONSTRAINT driver_events_type_ck CHECK (event_type ~ '^[a-z][a-z0-9_.]{2,47}$'),
  CONSTRAINT driver_events_actor_type_ck CHECK (actor_type IN ('DRIVER', 'ADMIN', 'SYSTEM')),
  CONSTRAINT driver_events_detail_ck CHECK (jsonb_typeof(detail) = 'object')
);
CREATE INDEX driver_events_driver_idx ON app.driver_events (driver_id, created_at DESC, event_id);

-- ---------------------------------------------------------------------------------------------------
-- Shipper wallet parameters (M03 setting, shared with M04)
-- ---------------------------------------------------------------------------------------------------
-- Minimum top-up and withdrawal amount PER REQUEST, in whole VND. These are not the minimum wallet balance needed to take orders
-- (that is an M04 rule). Defaults live HERE, in the database, not in code: the two rows are seeded once and only changed through the
-- administration web. A change applies to new requests only. Every change is recorded with old value, new value, actor and time.
CREATE TABLE app.shipper_wallet_parameters (
  param_key varchar(32) NOT NULL,
  int_value bigint NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL,

  CONSTRAINT shipper_wallet_parameters_pkey PRIMARY KEY (param_key),
  CONSTRAINT shipper_wallet_parameters_key_ck CHECK (param_key IN ('topup_min_vnd', 'withdraw_min_vnd')),
  CONSTRAINT shipper_wallet_parameters_value_ck CHECK (int_value >= 1 AND int_value <= 1000000000),
  CONSTRAINT shipper_wallet_parameters_version_ck CHECK (version >= 1),
  CONSTRAINT shipper_wallet_parameters_updated_by_fk FOREIGN KEY (updated_by) REFERENCES app.users (user_id)
);

INSERT INTO app.shipper_wallet_parameters (param_key, int_value, version, updated_by, updated_at)
VALUES ('topup_min_vnd', 100000, 1, NULL, date_trunc('milliseconds', clock_timestamp())),
       ('withdraw_min_vnd', 10000, 1, NULL, date_trunc('milliseconds', clock_timestamp()));

CREATE TABLE app.shipper_wallet_parameter_changes (
  change_id uuid NOT NULL,
  param_key varchar(32) NOT NULL,
  old_value bigint NOT NULL,
  new_value bigint NOT NULL,
  changed_by uuid NOT NULL,
  changed_at timestamptz NOT NULL,
  request_id uuid,

  CONSTRAINT shipper_wallet_parameter_changes_pkey PRIMARY KEY (change_id),
  CONSTRAINT shipper_wallet_parameter_changes_key_fk FOREIGN KEY (param_key) REFERENCES app.shipper_wallet_parameters (param_key),
  CONSTRAINT shipper_wallet_parameter_changes_by_fk FOREIGN KEY (changed_by) REFERENCES app.users (user_id),
  CONSTRAINT shipper_wallet_parameter_changes_values_ck CHECK (old_value >= 1 AND new_value >= 1 AND old_value <> new_value)
);
CREATE INDEX shipper_wallet_parameter_changes_idx ON app.shipper_wallet_parameter_changes (changed_at DESC, change_id);

-- Down Migration
-- Only for disposable test or experimental databases. Reverse order; no CASCADE and no IF EXISTS: it fails loudly on drift.
DROP TABLE app.shipper_wallet_parameter_changes;
DROP TABLE app.shipper_wallet_parameters;
DROP TABLE app.driver_events;
DROP TABLE app.driver_bank_accounts;
DROP INDEX app.drivers_full_name_idx;
DROP INDEX app.drivers_status_idx;
ALTER TABLE app.drivers
  DROP CONSTRAINT drivers_status_before_closing_ck,
  DROP CONSTRAINT drivers_suspension_reason_ck,
  DROP CONSTRAINT drivers_rejection_reason_ck,
  DROP CONSTRAINT drivers_review_state_ck,
  DROP CONSTRAINT drivers_reviewed_by_fk,
  DROP CONSTRAINT drivers_shipper_code_ck,
  DROP CONSTRAINT drivers_shipper_code_uq,
  DROP COLUMN closure_note,
  DROP COLUMN closure_requested_at,
  DROP COLUMN status_before_closing,
  DROP COLUMN suspended_at,
  DROP COLUMN suspension_reason,
  DROP COLUMN rejection_reason,
  DROP COLUMN reviewed_by,
  DROP COLUMN reviewed_at,
  DROP COLUMN submitted_at,
  DROP COLUMN review_state,
  DROP COLUMN shipper_code;
DROP FUNCTION app.next_shipper_code();
DROP SEQUENCE app.driver_code_seq;
