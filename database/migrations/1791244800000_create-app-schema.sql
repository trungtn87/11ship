-- Up Migration
-- M00-B1 smoke migration: creates the empty base schema only. No business tables, no seed data.
CREATE SCHEMA IF NOT EXISTS app;

-- Down Migration
-- Only for disposable test or experimental databases. No CASCADE: it fails if the schema is not
-- empty instead of silently dropping data.
DROP SCHEMA IF EXISTS app;
