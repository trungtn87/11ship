-- 03-runtime-function-grants.sql - the one function the runtime role ship11_app may execute (M01 final package, Owner decision 2026-10-14).
-- Run AFTER `npm run db:migrate:remote -- --apply` and 02-runtime-grants.sql, as the migration role, connected to database ship11_staging over
-- verified TLS:
--
--   psql "host=localhost port=5432 dbname=ship11_staging user=ship11_migrator sslmode=verify-full sslrootcert=<ca.crt>" \
--        -v ON_ERROR_STOP=1 -f 03-runtime-function-grants.sql
--
-- app.purge_app_user(uuid) permanently removes an APP_USER account that has no business data: its own sessions and device bindings, consents,
-- customer profile, roles and the user row (audit entries are kept). It is SECURITY DEFINER (owned by the migration role) so the runtime role needs
-- no DELETE privilege on any account table, it refuses an administration account and an account with a shop membership or a driver profile, and
-- PUBLIC has no EXECUTE on it. Idempotent. Kept apart from 02-runtime-grants.sql, which is a strict per-TABLE matrix.
--
-- Contains no secret.

GRANT EXECUTE ON FUNCTION app.purge_app_user(uuid) TO ship11_app;
