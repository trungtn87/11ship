-- 05-rollback-complaint-attachment-delete.sql — rollback of #261 (orphan complaint-picture janitor).
-- Revokes the runtime DELETE on app.complaint_attachments that 02-runtime-grants.sql grants. Use ONLY when the release is rolled back
-- to a version WITHOUT the janitor (PR #374 or later reverted). Idempotent: revoking a privilege that is not granted changes nothing.
--
-- Run as the migration role (owner of schema app), on ship11_staging only:
--   psql "host=localhost port=5432 dbname=ship11_staging user=ship11_migrator sslmode=verify-full" -v ON_ERROR_STOP=1 -f ops/selfhosted/05-rollback-complaint-attachment-delete.sql
--
-- After this file, DO NOT re-run 02-runtime-grants.sql on the rolled-back release: 02 grants DELETE again.
-- Recheck with the read-only 04, in the rollback mode (the expected set without DELETE):
--   psql "host=localhost port=5432 dbname=ship11_staging user=ship11_app sslmode=verify-full" -v ON_ERROR_STOP=1 \
--        -c "SET ship11.complaint_attachment_delete = 'revoked'" -f ops/selfhosted/04-check-runtime-grants.sql
-- Expected: SUMMARY "<n>/<n> checks OK" and no other row. Without the SET, 04 reports MISSING:DELETE (the current release expects DELETE).
--
-- Contains no secret. Changes no other grant, no trigger and no data.
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF current_database() <> 'ship11_staging' THEN
    RAISE EXCEPTION 'rollback refused: connected to %, expected ship11_staging', current_database();
  END IF;
END
$$;
BEGIN;
REVOKE DELETE ON app.complaint_attachments FROM ship11_app;
COMMIT;
