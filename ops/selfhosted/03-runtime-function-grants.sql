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

-- M03 (Shipper management): app.next_shipper_code() hands out the human-readable Shipper code (SH000001 ...) from a sequence the runtime role
-- cannot touch directly. SECURITY DEFINER, owned by the migration role, no EXECUTE for PUBLIC. It is the column default of app.drivers.shipper_code,
-- so the runtime role must be able to execute it when it inserts a driver.
GRANT EXECUTE ON FUNCTION app.next_shipper_code() TO ship11_app;

-- M11: app.next_complaint_code() hands out the human-readable complaint code (PA00001 ...) from a sequence the runtime role cannot touch directly.
-- SECURITY DEFINER, owned by the migration role, no EXECUTE for PUBLIC.
GRANT EXECUTE ON FUNCTION app.next_complaint_code() TO ship11_app;

-- M07/M10 #165: scoped shop public display codes; writes are never exposed.
GRANT EXECUTE ON FUNCTION app.shop_display_order(uuid) TO ship11_app;
GRANT EXECUTE ON FUNCTION app.shop_display_delivery(uuid) TO ship11_app;

-- Business finance message ordering, without direct sequence access.
GRANT EXECUTE ON FUNCTION app.next_business_message_sequence() TO ship11_app;
