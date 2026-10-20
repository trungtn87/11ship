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
-- UPDATE is required by ShopRepository.lockOwnedShop SELECT ... FOR UPDATE, even with no matching row.
GRANT SELECT, INSERT, UPDATE ON app.shop_members TO ship11_app;
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
GRANT SELECT, INSERT, UPDATE ON app.client_device_keys TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.client_device_challenges TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.client_device_registration_grants TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.client_device_bindings TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.client_device_key_links TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.client_session_bindings TO ship11_app;
GRANT SELECT, INSERT ON app.client_device_request_nonces TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.sms_gateway_devices TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.sms_gateway_control TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.sms_jobs TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.menu_categories TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.menu_images TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.menu_items TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.system_settings TO ship11_app;
GRANT SELECT, INSERT ON app.system_setting_changes TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.driver_bank_accounts TO ship11_app;
GRANT SELECT, INSERT ON app.driver_events TO ship11_app;
GRANT SELECT, UPDATE ON app.shipper_wallet_parameters TO ship11_app;
GRANT SELECT, INSERT ON app.shipper_wallet_parameter_changes TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.customers TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.customer_addresses TO ship11_app;
-- M04-A1/B2.2b: the Shipper wallet core. The runtime role creates a zero wallet and (B2.2b, one TOPUP posting in the Admin confirmation transaction) updates its
-- balance and appends a TOPUP ledger row; the ledger gate refuses every other kind and the ledger is append-only (no UPDATE, no DELETE).
GRANT SELECT, INSERT, UPDATE ON app.driver_wallets TO ship11_app;
GRANT SELECT, INSERT ON app.wallet_ledger_entries TO ship11_app;
-- M04-A2 / M07: the hold table. The runtime role reserves a COMMISSION hold for an ACTIVE assignment and resolves it once (CAPTURED or RELEASED); the hold gate refuses
-- every hold without a valid delivery assignment (a WITHDRAWAL hold stays refused until M04-C) and nothing is ever deleted.
GRANT SELECT, INSERT, UPDATE ON app.wallet_holds TO ship11_app;
-- M04-B1: topup sources. READ ONLY for the runtime role: no INSERT, UPDATE or DELETE on any of them, no UPDATE of the wallet and no INSERT into the ledger
-- (money cannot be posted in B1). The matrix must list every table, hence a SELECT row for each; B2/B3 narrow or extend it in the migration that opens a writer.
-- M04-B2.2a/b: SYSTEM adds a receiving account (INSERT, always can_receive = false) and switches receiving on or off (UPDATE of the flag; never DELETE).
GRANT SELECT, INSERT, UPDATE ON app.system_owned_bank_accounts TO ship11_app;
-- M04-B2.1: the Shipper creates a PENDING request and cancels it (INSERT, UPDATE). Nothing else of money is writable: topups, bank records, system accounts, ledger and wallet stay as above.
GRANT SELECT, INSERT, UPDATE ON app.wallet_topup_requests TO ship11_app;
-- M04-B2.2b: the Admin confirmation records the bank transaction once and the confirmed topup (INSERT only; both append-only).
GRANT SELECT, INSERT ON app.wallet_bank_transactions TO ship11_app;
GRANT SELECT, INSERT ON app.wallet_topups TO ship11_app;
-- M04-B2.2a: finance rights of the administration. SYSTEM gives (INSERT) and takes back (UPDATE) each right; never DELETE. Default deny: no row = no right.
GRANT SELECT, INSERT, UPDATE ON app.admin_finance_grants TO ship11_app;
-- M04-C: the withdrawal. The Shipper creates a request (INSERT) and the Admin / the Shipper move it along the state machine (UPDATE, guarded by a trigger; never DELETE). The
-- event trail and the commission policy versions are append-only (INSERT, never UPDATE or DELETE: triggers refuse them for every role).
GRANT SELECT, INSERT, UPDATE ON app.wallet_withdrawals TO ship11_app;
GRANT SELECT, INSERT ON app.wallet_withdrawal_events TO ship11_app;
GRANT SELECT, INSERT ON app.wallet_commission_policies TO ship11_app;
-- M06-A: the shipping-fee table. Versions are immutable (a trigger refuses UPDATE/DELETE/TRUNCATE for every role): the runtime only appends and reads. The draft is
-- the one seeded row; the runtime reads it and updates it (never deletes: a trigger refuses).
GRANT SELECT, INSERT ON app.shipping_fee_policy_versions TO ship11_app;
GRANT SELECT, UPDATE ON app.shipping_fee_policy_drafts TO ship11_app;
-- M06-B/C: the eligibility parameters (one seeded row: read and version-checked update, never deleted) and their append-only change log.
GRANT SELECT, UPDATE ON app.shipping_eligibility_parameters TO ship11_app;
GRANT SELECT, INSERT ON app.shipping_eligibility_parameter_changes TO ship11_app;
-- M06 v1.1: the shipping-fee agreement. The agreement row is read, inserted once per delivery and updated by the M06 service under FOR UPDATE (a trigger refuses DELETE,
-- TRUNCATE, identity changes, a shorter deadline and any status move off the graph); its event log is append-only (a trigger refuses UPDATE, DELETE and TRUNCATE).
GRANT SELECT, INSERT, UPDATE ON app.shipping_fee_agreements TO ship11_app;
GRANT SELECT, INSERT ON app.shipping_fee_agreement_events TO ship11_app;
-- M07: the delivery flow. The services write these under the lock order (Shipper, delivery, assignment, wallet); triggers refuse DELETE and any move off the state graph.
-- The commission (M04-A2.2 inside the M07 migration) reserves a hold, captures it into the ledger once, or releases it: hence UPDATE of the wallet and INSERT of the
-- ledger and the hold above, each guarded by the source-gate triggers (an INSERT needs an assignment) and the deferred invariants. Events and incidents never
-- change history: events are INSERT only. The latest Shipper position is one row per Shipper (upsert), never a trail.
GRANT SELECT, INSERT, UPDATE ON app.deliveries TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.delivery_assignments TO ship11_app;
GRANT SELECT, INSERT ON app.delivery_events TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.delivery_incidents TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.shipper_latest_locations TO ship11_app;

-- M10: food orders. The cart is a working copy (replaced or cleared: hence DELETE of it only); an Order is created and moved along its status graph, its lines are
-- written once and only the shop's edit columns change; nothing of an Order is ever deleted (triggers refuse it) and its event log is append-only.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.customer_carts TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.orders TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.order_items TO ship11_app;
GRANT SELECT, INSERT ON app.order_events TO ship11_app;

-- M08: notifications. The inbox, the push attempts and their bookkeeping. DELETE exists only where the retention pass removes rows after the total window
-- (Order, Delivery, ledger and audit rows are never touched); a push token is ended, never deleted.
GRANT SELECT, INSERT, UPDATE ON app.notification_push_tokens TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.notification_config TO ship11_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.notifications TO ship11_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.notification_pushes TO ship11_app;
GRANT SELECT, INSERT, DELETE ON app.notification_consumed_events TO ship11_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.notification_reminders TO ship11_app;
GRANT SELECT, INSERT, DELETE ON app.notification_offer_rounds TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.notification_settings TO ship11_app;

-- M11: ratings and complaints. Nothing is ever deleted (guard triggers); messages, moderations and reply history are append-only. The complaint code comes from
-- app.next_complaint_code() (03-runtime-function-grants.sql), not from a sequence privilege.
GRANT SELECT, INSERT, UPDATE ON app.reviews TO ship11_app;
GRANT SELECT, INSERT ON app.review_moderations TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.review_replies TO ship11_app;
GRANT SELECT, INSERT ON app.review_reply_history TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.complaints TO ship11_app;
GRANT SELECT, INSERT ON app.complaint_messages TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.complaint_attachments TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.complaint_reconsiderations TO ship11_app;
GRANT SELECT, INSERT, UPDATE ON app.complaint_adjustments TO ship11_app;

-- M04 adjustments (posted by the wallet package for a decision of M11): the record is append-only. The ledger row it comes with is covered by the ledger grant above.
GRANT SELECT, INSERT ON app.wallet_adjustments TO ship11_app;
