-- Up Migration
-- M06-A: flexible shipping-fee table (docs/current/M06-design-UI-LOCKED-2026-10-16.md section 2).
--
-- Scope: the Admin-managed fee table as IMMUTABLE policy versions plus one editable draft. NOT in scope: quotes, eligibility, batching
-- (M06-B/C/D), routes/GPS (M14), delivery (M07), wallet (M04).
--
-- Distances are whole METRES, half-open bands [from_m, to_m); the first band starts at 0 and the bands touch (no gap, no overlap).
-- Beyond the last band the fee is tail_base_fee_vnd + floor((d - last_to_m) / tail_step_m) * tail_step_fee_vnd, so every distance has
-- exactly one fee. There is NO built-in formula and NO seeded fee: until an Admin applies a version, no fee can be quoted (fail closed).
--
-- Safe on a database that has data: it only ADDS tables and one function; nothing existing is touched.

-- One definition of "a valid tier list", used by BOTH tables so the database refuses a wrong table whatever the application does.
CREATE FUNCTION app.shipping_fee_tiers_valid(tiers jsonb) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  n integer;
  i integer;
  el jsonb;
  prev_to bigint := 0;
  f bigint;
  t bigint;
  fee bigint;
BEGIN
  IF tiers IS NULL OR jsonb_typeof(tiers) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  n := jsonb_array_length(tiers);
  IF n < 1 OR n > 50 THEN
    RETURN false;
  END IF;
  FOR i IN 0 .. n - 1 LOOP
    el := tiers -> i;
    IF jsonb_typeof(el) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(el)) <> 3
       OR jsonb_typeof(el -> 'from_m') IS DISTINCT FROM 'number'
       OR jsonb_typeof(el -> 'to_m') IS DISTINCT FROM 'number'
       OR jsonb_typeof(el -> 'fee_vnd') IS DISTINCT FROM 'number'
       OR NOT COALESCE((el ->> 'from_m') ~ '^[0-9]{1,7}$', false)
       OR NOT COALESCE((el ->> 'to_m') ~ '^[0-9]{1,7}$', false)
       OR NOT COALESCE((el ->> 'fee_vnd') ~ '^[0-9]{1,8}$', false) THEN
      RETURN false;
    END IF;
    f := (el ->> 'from_m')::bigint;
    t := (el ->> 'to_m')::bigint;
    fee := (el ->> 'fee_vnd')::bigint;
    IF f <> prev_to OR t <= f OR fee > 10000000 THEN
      RETURN false;
    END IF;
    prev_to := t;
  END LOOP;
  RETURN prev_to <= 1000000;
END;
$$;

-- ---------------------------------------------------------------------------------------------------
-- app.shipping_fee_policy_versions (immutable: one row per "Áp dụng bảng giá")
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.shipping_fee_policy_versions (
  version_id uuid NOT NULL,
  version_no bigint NOT NULL,
  tiers jsonb NOT NULL,
  tail_base_fee_vnd bigint NOT NULL,
  tail_step_m bigint NOT NULL,
  tail_step_fee_vnd bigint NOT NULL,
  note varchar(200),
  applied_by uuid NOT NULL,
  applied_at timestamptz NOT NULL,
  request_id uuid,

  CONSTRAINT shipping_fee_policy_versions_pkey PRIMARY KEY (version_id),
  CONSTRAINT shipping_fee_policy_versions_no_uq UNIQUE (version_no),
  CONSTRAINT shipping_fee_policy_versions_no_ck CHECK (version_no >= 1),
  CONSTRAINT shipping_fee_policy_versions_tiers_ck CHECK (app.shipping_fee_tiers_valid(tiers)),
  CONSTRAINT shipping_fee_policy_versions_tail_ck CHECK (
    tail_base_fee_vnd BETWEEN 0 AND 10000000 AND tail_step_m BETWEEN 1 AND 100000 AND tail_step_fee_vnd BETWEEN 0 AND 10000000
  ),
  CONSTRAINT shipping_fee_policy_versions_by_fk FOREIGN KEY (applied_by) REFERENCES app.users (user_id)
);

CREATE FUNCTION app.shipping_fee_policy_versions_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.shipping_fee_policy_versions is immutable (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER shipping_fee_policy_versions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON app.shipping_fee_policy_versions
  FOR EACH STATEMENT EXECUTE FUNCTION app.shipping_fee_policy_versions_reject_mutation();

-- ---------------------------------------------------------------------------------------------------
-- app.shipping_fee_policy_drafts (exactly one row, seeded empty; the version only ever increases)
-- ---------------------------------------------------------------------------------------------------
-- "Lưu bản nháp" fills it; "Áp dụng" copies it into a new version and empties it. The version rises on every write, so a stale screen
-- is always a conflict, never a silent overwrite.
CREATE TABLE app.shipping_fee_policy_drafts (
  singleton boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1,
  tiers jsonb,
  tail_base_fee_vnd bigint,
  tail_step_m bigint,
  tail_step_fee_vnd bigint,
  updated_by uuid,
  updated_at timestamptz NOT NULL,

  CONSTRAINT shipping_fee_policy_drafts_pkey PRIMARY KEY (singleton),
  CONSTRAINT shipping_fee_policy_drafts_singleton_ck CHECK (singleton),
  CONSTRAINT shipping_fee_policy_drafts_version_ck CHECK (version >= 1),
  CONSTRAINT shipping_fee_policy_drafts_content_ck CHECK (
    (tiers IS NULL AND tail_base_fee_vnd IS NULL AND tail_step_m IS NULL AND tail_step_fee_vnd IS NULL)
    OR (
      app.shipping_fee_tiers_valid(tiers)
      AND tail_base_fee_vnd BETWEEN 0 AND 10000000
      AND tail_step_m BETWEEN 1 AND 100000
      AND tail_step_fee_vnd BETWEEN 0 AND 10000000
    )
  ),
  CONSTRAINT shipping_fee_policy_drafts_by_fk FOREIGN KEY (updated_by) REFERENCES app.users (user_id)
);
INSERT INTO app.shipping_fee_policy_drafts (singleton, version, updated_at) VALUES (true, 1, date_trunc('milliseconds', clock_timestamp()));

CREATE FUNCTION app.shipping_fee_policy_drafts_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'SHIPPING_DRAFT_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'app.shipping_fee_policy_drafts is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER shipping_fee_policy_drafts_guard BEFORE UPDATE ON app.shipping_fee_policy_drafts
  FOR EACH ROW EXECUTE FUNCTION app.shipping_fee_policy_drafts_guard();
CREATE TRIGGER shipping_fee_policy_drafts_no_delete BEFORE DELETE OR TRUNCATE ON app.shipping_fee_policy_drafts
  FOR EACH STATEMENT EXECUTE FUNCTION app.shipping_fee_policy_drafts_guard();

-- Down Migration
-- Only for disposable test or experimental databases. Reverse order; no CASCADE and no IF EXISTS: it fails loudly on drift.
DROP TABLE app.shipping_fee_policy_drafts;
DROP FUNCTION app.shipping_fee_policy_drafts_guard();
DROP TABLE app.shipping_fee_policy_versions;
DROP FUNCTION app.shipping_fee_policy_versions_reject_mutation();
DROP FUNCTION app.shipping_fee_tiers_valid(jsonb);
