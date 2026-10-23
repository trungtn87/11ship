-- Up Migration
-- Owner M03 2026-10-20: activation no longer requires profile approval.
ALTER TABLE app.drivers ADD COLUMN initial_funding_required boolean NOT NULL DEFAULT false;
ALTER TABLE app.drivers ALTER COLUMN initial_funding_required SET DEFAULT true;
-- Existing drivers keep their eligibility; newly created drivers need the configured first funding.
-- Review columns/events and stored banks remain historical data. SUSPENDED/CLOSING/CLOSED stay unchanged.
UPDATE app.drivers SET status = 'ACTIVE', accepting_deliveries = false,
 version = version + 1, updated_at = date_trunc('milliseconds', clock_timestamp()) WHERE status = 'PENDING';
INSERT INTO app.driver_wallets (wallet_id, driver_id, balance_vnd, held_vnd, version, created_at, updated_at)
 SELECT gen_random_uuid(), d.driver_id, 0, 0, 1, date_trunc('milliseconds', clock_timestamp()), date_trunc('milliseconds', clock_timestamp())
 FROM app.drivers d ON CONFLICT (driver_id) DO NOTHING;
-- Down Migration
-- Activation is a business decision; never put active accounts back into review or remove wallets.
SELECT 1;
