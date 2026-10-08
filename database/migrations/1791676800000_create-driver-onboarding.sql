-- Up Migration
-- M01-A2D: Driver onboarding schema (M03-owned drivers and driver_service_areas). It follows
-- docs/tasks/M01-A2-onboarding.md section 7 and the M01-A2D handoff. M03 identity tables only: no bank
-- account, wallet, closure, assignment or delivery tables, no approval columns and no seed data.
--
-- No IF [NOT] EXISTS anywhere: if any of these objects already exists the migration must fail (and be
-- rolled back as a whole, with no history row) instead of hiding schema drift. Applied migrations are never
-- edited; this is a new file after the Shop onboarding migration, whose app.service_areas it references, and
-- after the Auth Core migration, whose app.users it references.
--
-- No CASCADE anywhere: no delete of a user, a driver or a service area silently removes related rows.
--
-- Cross-row rules stay in the service layer and are re-checked under lock: that every area a driver is
-- registered for is ACTIVE when the driver is created (a CHECK cannot read another row), and that a driver has
-- at least one area (written in the same transaction as the driver).

-- ---------------------------------------------------------------------------------------------------
-- app.drivers
-- ---------------------------------------------------------------------------------------------------
-- One row per driver, at most one per user. Self-onboarding inserts exactly one shape: driver_type EXTERNAL,
-- status PENDING, accepting_deliveries false, version 1. PLATFORM and every later status are reachable only
-- through privileged lifecycle mutations that a later slice adds; A2D exposes no command that changes them.
-- The table allows the whole vocabulary so that slice does not have to rewrite A2D history, but it tightens
-- nothing about WHO may write it: that is the service layer's job.
CREATE TABLE app.drivers (
  driver_id uuid NOT NULL,
  user_id uuid NOT NULL,
  full_name varchar(120) NOT NULL,
  -- Optional: a driver without a registered vehicle plate still onboards.
  plate_number varchar(32),
  -- A classification, not a role. Legacy SYSTEM is not part of it (the SYSTEM role is an Auth administration
  -- level and is a different thing).
  driver_type varchar(16) NOT NULL DEFAULT 'EXTERNAL',
  status varchar(16) NOT NULL,
  -- Operational switch, separate from status. A driver that is not ACTIVE can never accept deliveries.
  accepting_deliveries boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT drivers_pkey PRIMARY KEY (driver_id),
  -- "One account, one Driver profile".
  CONSTRAINT drivers_user_uq UNIQUE (user_id),
  CONSTRAINT drivers_user_fk FOREIGN KEY (user_id) REFERENCES app.users (user_id),
  CONSTRAINT drivers_full_name_ck CHECK (length(btrim(full_name)) >= 1),
  CONSTRAINT drivers_plate_number_ck CHECK (plate_number IS NULL OR length(btrim(plate_number)) >= 1),
  CONSTRAINT drivers_type_ck CHECK (driver_type IN ('EXTERNAL', 'PLATFORM')),
  CONSTRAINT drivers_status_ck CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'CLOSED')),
  CONSTRAINT drivers_version_ck CHECK (version >= 1),
  CONSTRAINT drivers_time_order_ck CHECK (updated_at >= created_at),
  -- Only an ACTIVE driver may accept deliveries.
  CONSTRAINT drivers_not_active_not_accepting_ck CHECK (status = 'ACTIVE' OR accepting_deliveries = false)
);

-- ---------------------------------------------------------------------------------------------------
-- app.driver_service_areas
-- ---------------------------------------------------------------------------------------------------
-- The service areas a driver registered for. The composite primary key makes a duplicate (driver, area) pair
-- impossible at the database layer, whatever the service does.
CREATE TABLE app.driver_service_areas (
  driver_id uuid NOT NULL,
  service_area_id uuid NOT NULL,
  created_at timestamptz NOT NULL,

  CONSTRAINT driver_service_areas_pkey PRIMARY KEY (driver_id, service_area_id),
  CONSTRAINT driver_service_areas_driver_fk FOREIGN KEY (driver_id) REFERENCES app.drivers (driver_id),
  CONSTRAINT driver_service_areas_area_fk FOREIGN KEY (service_area_id) REFERENCES app.service_areas (service_area_id)
);

-- The primary key serves lookups by driver. This index serves the foreign key from the area side (what a row
-- lock or a delete of a service area has to check) and "which drivers cover this area".
CREATE INDEX driver_service_areas_area_idx ON app.driver_service_areas (service_area_id);

-- Down Migration
-- Only for disposable test or experimental databases. Reverse dependency order (driver_service_areas
-- references drivers and service_areas, drivers references users); indexes go with their table. No CASCADE and
-- no IF EXISTS: it fails loudly if anything is missing instead of hiding drift. It must run BEFORE the Shop
-- onboarding down migration (which drops app.service_areas) and the Auth Core down migration (which drops
-- app.users); migration runners apply down migrations in reverse order, so that holds.
DROP TABLE app.driver_service_areas;
DROP TABLE app.drivers;
