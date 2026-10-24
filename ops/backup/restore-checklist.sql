-- M12-F: READ-ONLY checks to run on a restored copy BEFORE it is allowed near production (psql -f, any database). It writes nothing. It answers: where does this backup stop, do the wallets
-- and the ledger agree, and what was still in flight at that moment (those are the things that must be reconciled with the outside world by hand).
\pset tuples_only on
\pset format unaligned
SELECT 'backup_stops_at|latest ledger row ' || COALESCE((SELECT max(created_at)::text FROM app.wallet_ledger_entries), 'none') || '; latest audit row ' || COALESCE((SELECT max(occurred_at)::text FROM app.audit_logs), 'none') || '; latest order ' || COALESCE((SELECT max(created_at)::text FROM app.orders), 'none') || '; latest delivery ' || COALESCE((SELECT max(created_at)::text FROM app.deliveries), 'none');
SELECT 'ledger_wallet_difference_vnd|' || (COALESCE((SELECT sum(delta_vnd) FROM app.wallet_ledger_entries), 0) - COALESCE((SELECT sum(balance_vnd) FROM app.driver_wallets), 0)) || '  (must be 0)';
SELECT 'wallet_balance_vs_last_ledger_row_mismatches|' || count(*) || '  (must be 0)' FROM app.driver_wallets w WHERE balance_vnd <> COALESCE((SELECT balance_after_vnd FROM app.wallet_ledger_entries l WHERE l.wallet_id = w.wallet_id ORDER BY sequence_no DESC LIMIT 1), 0);
SELECT 'active_holds|' || count(*) || ' holding ' || COALESCE(sum(amount_vnd), 0) || ' VND  (each belongs to a live delivery/withdrawal at that moment; compare with what really happened after)' FROM app.wallet_holds WHERE status = 'ACTIVE';
SELECT 'withdrawals_in_flight|' || state || ' = ' || count(*) || '  (the BANK decides, not this row: confirm each against the bank statement)' FROM app.wallet_withdrawals WHERE state NOT IN ('COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED', 'RECONCILED') GROUP BY state;
SELECT 'topups_pending|' || count(*) || '  (money may have arrived after the backup: check the bank statement before re-entering)' FROM app.wallet_topup_requests WHERE state = 'PENDING';
SELECT 'orders_not_final|' || status || ' = ' || count(*) FROM app.orders WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED') GROUP BY status;
SELECT 'deliveries_not_final|' || state || ' = ' || count(*) FROM app.deliveries WHERE state NOT IN ('completed', 'failed', 'cancelled_by_merchant', 'search_stopped') GROUP BY state;
SELECT 'background_sms_jobs_waiting|' || status || ' = ' || count(*) || '  (old codes: expired, never replay)' FROM app.sms_jobs WHERE status IN ('PENDING', 'QUEUED', 'LEASED') GROUP BY status;
SELECT 'background_push_waiting|' || status || ' = ' || count(*) || '  (never replay)' FROM app.notification_pushes WHERE status IN ('PENDING', 'QUEUED', 'RETRY') GROUP BY status;
SELECT 'background_outbox_unpublished|' || status || ' = ' || count(*) FROM app.outbox_events WHERE status <> 'PUBLISHED' GROUP BY status;
SELECT 'discord_alerts_enabled|' || discord_enabled || '  (the restored copy still holds the encrypted webhook; keep it OFF until the system is verified)' FROM app.ops_config;
