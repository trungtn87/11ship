-- Read-only check of the existing ship11_app privileges. No GRANT, schema/data change or secret output.
-- Run as postgres (or an operator) on ship11_staging. Only counts and missing object/privilege names are printed.
-- Expected table privileges match 02-runtime-grants.sql; function privileges match 03-runtime-function-grants.sql.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
WITH expected(table_name, privileges) AS (
  VALUES
    ('users', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('user_roles', ARRAY['SELECT', 'INSERT']::text[]),
    ('phone_verifications', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('verification_proofs', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('sessions', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('service_areas', ARRAY['SELECT', 'UPDATE']::text[]),
    ('shops', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('shop_members', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('drivers', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('shop_business_hours', ARRAY['SELECT', 'INSERT', 'DELETE']::text[]),
    ('idempotency_records', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]),
    ('outbox_events', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('audit_logs', ARRAY['INSERT']::text[]),
    ('admin_memberships', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('admin_auth_challenges', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('admin_totp_factors', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]),
    ('admin_sessions', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('admin_auth_limit_config', ARRAY['SELECT']::text[]),
    ('admin_auth_limits', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('admin_invitations', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('admin_invitation_permissions', ARRAY['SELECT', 'INSERT']::text[]),
    ('admin_sensitive_operations', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('admin_activation_attempts', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('admin_activation_otp_challenges', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('admin_profiles', ARRAY['SELECT', 'INSERT']::text[]),
    ('admin_app_permissions', ARRAY['SELECT', 'INSERT']::text[]),
    ('customer_profiles', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('user_consents', ARRAY['SELECT', 'INSERT']::text[]),
    ('client_device_keys', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('client_device_challenges', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('client_device_registration_grants', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('client_device_bindings', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('client_device_key_links', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('client_session_bindings', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('client_device_request_nonces', ARRAY['SELECT', 'INSERT']::text[]),
    ('sms_gateway_devices', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('sms_gateway_control', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('sms_jobs', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('menu_categories', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('menu_images', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('menu_items', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('system_settings', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('system_setting_changes', ARRAY['SELECT', 'INSERT']::text[]),
    ('driver_bank_accounts', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('driver_events', ARRAY['SELECT', 'INSERT']::text[]),
    ('shipper_wallet_parameters', ARRAY['SELECT', 'UPDATE']::text[]),
    ('shipper_wallet_parameter_changes', ARRAY['SELECT', 'INSERT']::text[]),
    ('customers', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('customer_addresses', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('driver_wallets', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('wallet_ledger_entries', ARRAY['SELECT', 'INSERT']::text[]),
    ('wallet_holds', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('system_owned_bank_accounts', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('wallet_topup_requests', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('wallet_bank_transactions', ARRAY['SELECT', 'INSERT']::text[]),
    ('wallet_topups', ARRAY['SELECT', 'INSERT']::text[]),
    ('wallet_withdrawals', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('wallet_withdrawal_events', ARRAY['SELECT', 'INSERT']::text[]),
    ('wallet_commission_policies', ARRAY['SELECT', 'INSERT']::text[]),
    ('admin_finance_grants', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('shipping_fee_policy_versions', ARRAY['SELECT', 'INSERT']::text[]),
    ('shipping_fee_policy_drafts', ARRAY['SELECT', 'UPDATE']::text[]),
    ('shipping_eligibility_parameters', ARRAY['SELECT', 'UPDATE']::text[]),
    ('shipping_eligibility_parameter_changes', ARRAY['SELECT', 'INSERT']::text[]),
    ('shipping_fee_agreements', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('shipping_fee_agreement_events', ARRAY['SELECT', 'INSERT']::text[]),
    ('deliveries', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('delivery_assignments', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('delivery_events', ARRAY['SELECT', 'INSERT']::text[]),
    ('delivery_incidents', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('shipper_latest_locations', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('shop_public_ids', ARRAY['SELECT']::text[]),
    ('shop_display_counters', ARRAY['SELECT']::text[]),
    ('shop_display_numbers', ARRAY['SELECT']::text[]),
    ('customer_carts', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]),
    ('orders', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('order_items', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('order_events', ARRAY['SELECT', 'INSERT']::text[]),
    ('order_timeout_policy', ARRAY['SELECT', 'UPDATE']::text[]),
    ('order_timeout_policy_changes', ARRAY['SELECT', 'INSERT']::text[]),
    ('cancellation_transitions', ARRAY['SELECT', 'INSERT']::text[]),
    ('notification_push_tokens', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('notification_config', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('notifications', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]),
    ('notification_pushes', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]),
    ('notification_consumed_events', ARRAY['SELECT', 'INSERT', 'DELETE']::text[]),
    ('notification_reminders', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]),
    ('notification_offer_rounds', ARRAY['SELECT', 'INSERT', 'DELETE']::text[]),
    ('notification_settings', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('reviews', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('review_moderations', ARRAY['SELECT', 'INSERT']::text[]),
    ('review_replies', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('review_reply_history', ARRAY['SELECT', 'INSERT']::text[]),
    ('complaints', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('complaint_messages', ARRAY['SELECT', 'INSERT']::text[]),
    ('complaint_attachments', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('complaint_reconsiderations', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('complaint_adjustments', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('wallet_adjustments', ARRAY['SELECT', 'INSERT']::text[])
), table_checks AS (
  SELECT 'app.' || table_name || ':' || privilege AS check_name,
         CASE WHEN to_regclass('app.' || table_name) IS NULL THEN 'MISSING_TABLE'
              WHEN NOT has_table_privilege('ship11_app', to_regclass('app.' || table_name), privilege) THEN 'MISSING_PRIVILEGE'
              ELSE 'OK' END AS result
    FROM expected CROSS JOIN LATERAL unnest(privileges) AS p(privilege)
), functions(signature) AS (
  VALUES ('app.purge_app_user(uuid)'), ('app.next_shipper_code()'), ('app.next_complaint_code()'),
         ('app.shop_display_order(uuid)'), ('app.shop_display_delivery(uuid)')
), function_checks AS (
  SELECT signature || ':EXECUTE' AS check_name,
         CASE WHEN to_regprocedure(signature) IS NULL THEN 'MISSING_FUNCTION'
              WHEN NOT has_function_privilege('ship11_app', to_regprocedure(signature), 'EXECUTE') THEN 'MISSING_PRIVILEGE'
              ELSE 'OK' END AS result
    FROM functions
), checks AS (
  SELECT * FROM table_checks
  UNION ALL SELECT * FROM function_checks
  UNION ALL SELECT 'app:USAGE', CASE WHEN NOT has_schema_privilege('ship11_app', 'app', 'USAGE') THEN 'MISSING_PRIVILEGE' ELSE 'OK' END
  UNION ALL SELECT 'database', CASE WHEN current_database() = 'ship11_staging' THEN 'OK' ELSE 'WRONG_DATABASE' END
)
SELECT 'SUMMARY' AS check_name,
       format('%s/%s checks OK (%s tables)', count(*) FILTER (WHERE result = 'OK'), count(*), (SELECT count(*) FROM expected)) AS result
  FROM checks
UNION ALL
SELECT check_name, result FROM checks WHERE result <> 'OK'
ORDER BY check_name;
COMMIT;
