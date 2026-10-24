-- M12-F: sample data for a restore REHEARSAL. Refuses to run anywhere but a database named ship11_rehearsal_*: it writes with triggers and foreign keys off, which is only
-- acceptable in a throwaway copy. The wallet balances and the ledger are consistent (balance = sum of deltas), so the restore check has something real to prove.
DO $$ BEGIN
  IF current_database() !~ '^ship11_rehearsal_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'REFUSED: % is not a rehearsal database', current_database();
  END IF;
END $$;
-- The sample rows have no real drivers, top-ups or commission assignments behind them. In THIS throwaway copy only, the foreign keys of the two tables are dropped so the
-- sample can exist; the rehearsal then proves the mechanics (dump, encryption, restore, counts, ledger = wallets), not the referential integrity of live data.
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conrelid::regclass AS rel, conname FROM pg_constraint WHERE contype = 'f' AND conrelid IN ('app.driver_wallets'::regclass, 'app.wallet_ledger_entries'::regclass) LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.rel, c.conname);
  END LOOP;
END $$;
SET session_replication_role = replica;
INSERT INTO app.driver_wallets (wallet_id, driver_id, balance_vnd, held_vnd, version, created_at, updated_at)
SELECT gen_random_uuid(), gen_random_uuid(), 0, 0, 1, now(), now() FROM generate_series(1, 5);
INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at, topup_id, commission_assignment_id)
SELECT gen_random_uuid(), w.wallet_id, s.n, CASE WHEN s.n = 1 THEN 'TOPUP' ELSE 'COMMISSION_DEBIT' END, CASE WHEN s.n = 1 THEN 100000 ELSE -5000 END,
       CASE WHEN s.n = 1 THEN 100000 ELSE 100000 - 5000 * (s.n - 1) END, now() - make_interval(mins => 10 - s.n::int), CASE WHEN s.n = 1 THEN gen_random_uuid() END, CASE WHEN s.n > 1 THEN gen_random_uuid() END
  FROM app.driver_wallets w CROSS JOIN generate_series(1, 4) AS s(n);
UPDATE app.driver_wallets SET balance_vnd = 85000;
INSERT INTO app.audit_logs (audit_id, occurred_at, request_id, actor_type, actor_id, action, resource_type, resource_id, resource_version, outcome, reason_code, metadata)
SELECT gen_random_uuid(), now() - make_interval(secs => n), gen_random_uuid(), 'SYSTEM', 'rehearsal', 'rehearsal.seed.v1', 'rehearsal', n::text, 1, 'SUCCESS', NULL, jsonb_build_object('n', n)
  FROM generate_series(1, 500) AS g(n);
