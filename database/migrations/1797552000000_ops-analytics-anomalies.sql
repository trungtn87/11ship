-- Up Migration
-- Issues #241 / #242 (Owner 2026-10-31). Two things the operations dashboard needs and the system did not keep:
--  * app.ops_online_snapshots: every 15 minutes the COUNT of Shippers who are Online (and of those with a usable fresh position). Counts only: no driver id, no coordinate,
--    nothing that could extend the retention of raw GPS. Used for the supply side of the supply / demand heat map; absent slots stay absent (never filled with 0).
--  * app.ops_anomaly_*: cases the rules open for an administrator to REVIEW. A case is a signal with its evidence, never a verdict: nothing here changes an account,
--    a wallet, an order or the right to take work. Settings (window, minimum sample, rates) are one SYSTEM-editable row with a version.

CREATE TABLE app.ops_online_snapshots (
  slot_at timestamptz NOT NULL,
  online_count integer NOT NULL,
  ready_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ops_online_snapshots_pkey PRIMARY KEY (slot_at),
  CONSTRAINT ops_online_snapshots_counts_ck CHECK (online_count >= 0 AND ready_count >= 0 AND ready_count <= online_count)
);

CREATE TABLE app.ops_anomaly_settings (
  singleton boolean NOT NULL DEFAULT true,
  window_days integer NOT NULL,
  min_samples integer NOT NULL,
  rate_pct integer NOT NULL,
  repeat_per_day integer NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ops_anomaly_settings_pkey PRIMARY KEY (singleton),
  CONSTRAINT ops_anomaly_settings_one_ck CHECK (singleton),
  CONSTRAINT ops_anomaly_settings_bounds_ck CHECK (window_days BETWEEN 1 AND 30 AND min_samples BETWEEN 2 AND 100 AND rate_pct BETWEEN 1 AND 100 AND repeat_per_day BETWEEN 2 AND 50)
);
-- The defaults the Owner set on 2026-10-31: 7 days, at least 5 samples, 40 % rate, 3 repeats a day. SYSTEM may change them.
INSERT INTO app.ops_anomaly_settings (singleton, window_days, min_samples, rate_pct, repeat_per_day) VALUES (true, 7, 5, 40, 3);

CREATE TABLE app.ops_anomaly_cases (
  case_id uuid NOT NULL,
  rule_kind varchar(32) NOT NULL,
  subject_kind varchar(8) NOT NULL,
  subject_id uuid NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'NEW',
  occurrences integer NOT NULL,
  sample integer NOT NULL,
  rate_pct numeric(5, 2),
  window_from timestamptz NOT NULL,
  window_to timestamptz NOT NULL,
  evidence jsonb NOT NULL,
  last_evidence_at timestamptz NOT NULL,
  note text,
  version bigint NOT NULL DEFAULT 1,
  first_flagged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ops_anomaly_cases_pkey PRIMARY KEY (case_id),
  CONSTRAINT ops_anomaly_cases_rule_ck CHECK (rule_kind IN ('CUSTOMER_ORDER_CANCELS', 'DIRECT_CALL_CANCELS', 'SHIPPER_ABANDONS', 'REPEAT_PAIR_CANCELS')),
  CONSTRAINT ops_anomaly_cases_subject_ck CHECK (subject_kind IN ('USER', 'DRIVER')),
  CONSTRAINT ops_anomaly_cases_status_ck CHECK (status IN ('NEW', 'REVIEWING', 'CHECKED', 'DISMISSED')),
  CONSTRAINT ops_anomaly_cases_counts_ck CHECK (occurrences >= 0 AND sample >= occurrences),
  CONSTRAINT ops_anomaly_cases_closed_ck CHECK ((status IN ('CHECKED', 'DISMISSED')) = (closed_at IS NOT NULL))
);
-- One OPEN case per rule and subject: a retry, a recompute or a late event can only update it. A closed case does not block a later one.
CREATE UNIQUE INDEX ops_anomaly_cases_open_uq ON app.ops_anomaly_cases (rule_kind, subject_id) WHERE status IN ('NEW', 'REVIEWING');
CREATE INDEX ops_anomaly_cases_list_idx ON app.ops_anomaly_cases (status, updated_at DESC);

CREATE TABLE app.ops_anomaly_case_events (
  event_id uuid NOT NULL,
  case_id uuid NOT NULL,
  action varchar(12) NOT NULL,
  from_status varchar(10),
  to_status varchar(10) NOT NULL,
  note text,
  actor_user_id uuid,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ops_anomaly_case_events_pkey PRIMARY KEY (event_id),
  CONSTRAINT ops_anomaly_case_events_case_fk FOREIGN KEY (case_id) REFERENCES app.ops_anomaly_cases (case_id) ON DELETE RESTRICT
);
CREATE INDEX ops_anomaly_case_events_case_idx ON app.ops_anomaly_case_events (case_id, at);

-- Down Migration
DROP TABLE app.ops_anomaly_case_events;
DROP TABLE app.ops_anomaly_cases;
DROP TABLE app.ops_anomaly_settings;
DROP TABLE app.ops_online_snapshots;
