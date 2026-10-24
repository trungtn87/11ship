-- M12-F: checks run against a RESTORED scratch database (never against the live one). Output is "name|value" lines read by backup.sh / restore-rehearsal.sh.
\pset tuples_only on
\pset format unaligned
SELECT 'schema_version|' || COALESCE((SELECT name FROM public.pgmigrations ORDER BY id DESC LIMIT 1), 'NONE');
SELECT 'users|' || count(*) FROM app.users;
SELECT 'audit_logs|' || count(*) FROM app.audit_logs;
SELECT 'wallet_ledger_entries|' || count(*) FROM app.wallet_ledger_entries;
SELECT 'wallets|' || count(*) FROM app.driver_wallets;
-- The wallet balances and the ledger must agree after a restore (M04: balance = sum of the ledger deltas).
SELECT 'ledger_wallet_difference_vnd|' || (COALESCE((SELECT sum(delta_vnd) FROM app.wallet_ledger_entries), 0) - COALESCE((SELECT sum(balance_vnd) FROM app.driver_wallets), 0));
SELECT 'orders|' || count(*) FROM app.orders;
SELECT 'deliveries|' || count(*) FROM app.deliveries;
SELECT 'open_holds|' || count(*) FROM app.wallet_holds WHERE status = 'ACTIVE';
