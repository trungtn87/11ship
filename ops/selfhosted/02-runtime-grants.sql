-- 02-runtime-grants.sql — explicit per-table privileges of the runtime role ship11_app on the self-hosted staging
-- PostgreSQL (M00-VPS-01). Run AFTER `npm run db:migrate:remote -- --apply` created the tables, as the migration role
-- (it owns schema app and every table), connected to database ship11_staging over verified TLS:
--
--   psql "host=localhost port=5432 dbname=ship11_staging user=ship11_migrator sslmode=verify-full sslrootcert=<ca.crt>" \
--        -v ON_ERROR_STOP=1 -f 02-runtime-grants.sql
--
-- Idempotent: GRANT of a privilege that is already held changes nothing. There is no ALTER DEFAULT PRIVILEGES, no
-- sequence grant (no sequences are used), no GRANT ALL, no TRUNCATE/REFERENCES/TRIGGER, and no access to
-- app.pgmigrations. audit_logs is INSERT-only. This file is the same matrix as the table in
-- ops/runbooks/render-supabase-staging.md section 3 (derived from reading the source); tests/selfhosted checks that the
-- two stay equal and that they cover exactly the tables the migrations create. A new migration that adds a table must
-- add its row to BOTH places in the same change.
--
-- Contains no secret.

GRANT SELECT, INSERT, UPDATE ON app.users TO ship11_app;
GRANT SELECT, INSERT ON app.user_roles TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.phone_verifications TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.verification_proofs TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.sessions TO ship11_app;
GRANT SELECT, UPDATE ON app.service_areas TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.shops TO ship11_app;
GRANT SELECT, INSERT ON app.shop_members TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.drivers TO ship11_app;
GRANT SELECT, INSERT, DELETE ON app.shop_business_hours TO ship11_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.idempotency_records TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.outbox_events TO ship11_app;
GRANT INSERT ON app.audit_logs TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.admin_memberships TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.admin_auth_challenges TO ship11_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.admin_totp_factors TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.admin_sessions TO ship11_app;
GRANT SELECT ON app.admin_auth_limit_config TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.admin_auth_limits TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.admin_invitations TO ship11_app;
GRANT SELECT, INSERT ON app.admin_invitation_permissions TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.admin_sensitive_operations TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.admin_activation_attempts TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.admin_activation_otp_challenges TO ship11_app;
GRANT SELECT, INSERT ON app.admin_profiles TO ship11_app;
GRANT SELECT, INSERT ON app.admin_app_permissions TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.customer_profiles TO ship11_app;
GRANT SELECT, INSERT ON app.user_consents TO ship11_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.client_device_keys TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.client_device_challenges TO ship11_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.client_device_registration_grants TO ship11_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.client_device_bindings TO ship11_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.client_device_key_links TO ship11_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.client_session_bindings TO ship11_app;
GRANT SELECT, INSERT ON app.client_device_request_nonces TO ship11_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.sms_gateway_devices TO ship11_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.sms_gateway_control TO ship11_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.sms_jobs TO ship11_app;
