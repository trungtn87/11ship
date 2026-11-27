-- Up Migration
-- Owner 2026-11-27: a top-up request that the Shipper never reported ends by itself after one hour. The system ends it (resolved_by_system),
-- never a person, so the history says what happened. A request that was reported is never ended this way.

ALTER TABLE app.wallet_topup_requests DROP CONSTRAINT wallet_topup_requests_system_actor_ck;
ALTER TABLE app.wallet_topup_requests ADD CONSTRAINT wallet_topup_requests_system_actor_ck
  CHECK (resolved_by_system IS NULL OR resolved_by_system IN ('SEPAY_WEBHOOK', 'TOPUP_EXPIRY'));
ALTER TABLE app.wallet_topup_requests ADD CONSTRAINT wallet_topup_requests_expiry_ck
  CHECK (resolved_by_system IS DISTINCT FROM 'TOPUP_EXPIRY' OR (state = 'CANCELLED' AND reported_at IS NULL));

-- The expiry job scans only the requests that can still expire.
CREATE INDEX wallet_topup_requests_unreported_idx ON app.wallet_topup_requests (created_at)
  WHERE state = 'PENDING' AND reported_at IS NULL;

-- Down Migration
-- Only for disposable or experimental databases. Refused, data untouched, when any request was ended by the expiry job: history is never dropped.
LOCK TABLE app.wallet_topup_requests IN ACCESS EXCLUSIVE MODE;
DO $latch$
BEGIN
  IF EXISTS (SELECT 1 FROM app.wallet_topup_requests WHERE resolved_by_system = 'TOPUP_EXPIRY') THEN
    RAISE EXCEPTION 'TOPUP_EXPIRY_DOWN_REFUSED: requests ended by the expiry job exist; history is never dropped' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$latch$;
DROP INDEX app.wallet_topup_requests_unreported_idx;
ALTER TABLE app.wallet_topup_requests DROP CONSTRAINT wallet_topup_requests_expiry_ck;
ALTER TABLE app.wallet_topup_requests DROP CONSTRAINT wallet_topup_requests_system_actor_ck;
ALTER TABLE app.wallet_topup_requests ADD CONSTRAINT wallet_topup_requests_system_actor_ck
  CHECK (resolved_by_system IS NULL OR resolved_by_system = 'SEPAY_WEBHOOK');
