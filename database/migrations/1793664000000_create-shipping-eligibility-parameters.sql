-- Up Migration
-- M06-B/C: the Admin-managed parameters of "điều kiện nhận đơn" and "điều kiện ghép đơn" (docs/current/M06-design-UI-LOCKED-2026-10-16.md
-- sections 3-5). One row, versioned, every change logged (old, new, actor, time). NOT here: the 5 km search radius (a fixed rule in code,
-- never a setting), GPS/route settings (M14), assignments (M07), wallet (M04). Safe on a database that has data: it only ADDS two tables.
--
-- Defaults live here, in the database. external_max_deliveries = 3 and batch_max_delay_seconds = 300 are the Owner-approved defaults.
-- pickup_service_seconds / handoff_service_seconds (time spent taking the goods and handing them over, counted in the batching ETA) were
-- NOT given a value by the approved design: 120 / 60 are a working assumption the Owner can change in the Admin Web.
CREATE TABLE app.shipping_eligibility_parameters (
  singleton boolean NOT NULL DEFAULT true,
  external_max_deliveries integer NOT NULL,
  batch_max_delay_seconds integer NOT NULL,
  pickup_service_seconds integer NOT NULL,
  handoff_service_seconds integer NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL,

  CONSTRAINT shipping_eligibility_parameters_pkey PRIMARY KEY (singleton),
  CONSTRAINT shipping_eligibility_parameters_singleton_ck CHECK (singleton),
  CONSTRAINT shipping_eligibility_parameters_external_ck CHECK (external_max_deliveries BETWEEN 1 AND 20),
  CONSTRAINT shipping_eligibility_parameters_delay_ck CHECK (batch_max_delay_seconds BETWEEN 0 AND 3600),
  CONSTRAINT shipping_eligibility_parameters_pickup_ck CHECK (pickup_service_seconds BETWEEN 0 AND 1800),
  CONSTRAINT shipping_eligibility_parameters_handoff_ck CHECK (handoff_service_seconds BETWEEN 0 AND 1800),
  CONSTRAINT shipping_eligibility_parameters_version_ck CHECK (version >= 1),
  CONSTRAINT shipping_eligibility_parameters_by_fk FOREIGN KEY (updated_by) REFERENCES app.users (user_id)
);
INSERT INTO app.shipping_eligibility_parameters (singleton, external_max_deliveries, batch_max_delay_seconds, pickup_service_seconds, handoff_service_seconds, version, updated_at)
VALUES (true, 3, 300, 120, 60, 1, date_trunc('milliseconds', clock_timestamp()));

CREATE FUNCTION app.shipping_eligibility_parameters_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'SHIPPING_ELIGIBILITY_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'app.shipping_eligibility_parameters is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER shipping_eligibility_parameters_guard BEFORE UPDATE ON app.shipping_eligibility_parameters
  FOR EACH ROW EXECUTE FUNCTION app.shipping_eligibility_parameters_guard();
CREATE TRIGGER shipping_eligibility_parameters_no_delete BEFORE DELETE OR TRUNCATE ON app.shipping_eligibility_parameters
  FOR EACH STATEMENT EXECUTE FUNCTION app.shipping_eligibility_parameters_guard();

CREATE TABLE app.shipping_eligibility_parameter_changes (
  change_id uuid NOT NULL,
  version_after bigint NOT NULL,
  old_values jsonb NOT NULL,
  new_values jsonb NOT NULL,
  changed_by uuid NOT NULL,
  changed_at timestamptz NOT NULL,
  request_id uuid,

  CONSTRAINT shipping_eligibility_parameter_changes_pkey PRIMARY KEY (change_id),
  CONSTRAINT shipping_eligibility_parameter_changes_version_uq UNIQUE (version_after),
  CONSTRAINT shipping_eligibility_parameter_changes_by_fk FOREIGN KEY (changed_by) REFERENCES app.users (user_id),
  CONSTRAINT shipping_eligibility_parameter_changes_values_ck CHECK (old_values <> new_values)
);

CREATE FUNCTION app.shipping_eligibility_changes_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.shipping_eligibility_parameter_changes is append-only (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER shipping_eligibility_changes_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON app.shipping_eligibility_parameter_changes
  FOR EACH STATEMENT EXECUTE FUNCTION app.shipping_eligibility_changes_reject_mutation();

-- Down Migration
-- Only for disposable test or experimental databases. Reverse order; no CASCADE and no IF EXISTS: it fails loudly on drift.
DROP TABLE app.shipping_eligibility_parameter_changes;
DROP FUNCTION app.shipping_eligibility_changes_reject_mutation();
DROP TABLE app.shipping_eligibility_parameters;
DROP FUNCTION app.shipping_eligibility_parameters_guard();
