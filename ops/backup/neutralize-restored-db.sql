-- M12-F: for a REHEARSAL copy only (database name ship11_restore_*): makes sure that nothing started against this copy can talk to the outside world. It switches Discord off and removes
-- the stored webhook. It refuses to run anywhere else. SMS, push and bank calls need running workers and credentials from the real environment: do NOT start the backend against a
-- rehearsal copy at all; check it with restore-checklist.sql and verify.sql (SQL only).
DO $$ BEGIN
  IF current_database() !~ '^ship11_restore_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'REFUSED: % is not a restore rehearsal database', current_database();
  END IF;
END $$;
UPDATE app.ops_config SET discord_enabled = false, webhook_ciphertext = NULL, webhook_iv = NULL, webhook_tag = NULL, webhook_key_id = NULL, webhook_updated_at = NULL, version = version + 1;
SELECT 'discord_enabled|' || discord_enabled || ' webhook_present|' || (webhook_ciphertext IS NOT NULL) FROM app.ops_config;
