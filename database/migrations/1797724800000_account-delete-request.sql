-- Up Migration
-- P5-6a (Owner decision OD-26): an APP_USER account can ask for its own deletion with phone + current password (app and public web page).
-- ADDITIVE only: no earlier migration, no enum and no lock_reason constraint is changed.
--
--  * app.users.delete_requested_at: set while the owner has confirmed the deletion but orders / deliveries / money are still being
--    processed (state DELETE_REQUEST_PENDING). The account stays ACTIVE and keeps its sessions so the running work can be finished; every
--    entry point that creates NEW work refuses it. It ends only when the request is carried out (the finalizer purges the
--    account or locks it DELETE_REQUEST). An administrative lock (VIOLATION / SECURITY) and its unlock do NOT cancel it (OD-26: no cancel).
--    users_delete_request_ck: it exists on an ACTIVE row (pending) or on a row an administrator locked for VIOLATION / SECURITY; never together with
--    DELETE_REQUEST (that lock is the end of the request). The lock_reason / locked_at pair of DISABLED rows is untouched.
--  * app.account_delete_limits: the quota of POST /v1/account-deletion/confirm, separate from client_login_limits and the OTP quotas.
--    HMAC keys only (no phone, no address); two buckets are counted per request (client address, phone).

ALTER TABLE app.users ADD COLUMN delete_requested_at timestamptz;
ALTER TABLE app.users ADD CONSTRAINT users_delete_request_ck CHECK (delete_requested_at IS NULL OR status = 'ACTIVE' OR lock_reason IN ('VIOLATION', 'SECURITY'));
CREATE INDEX users_delete_requested_idx ON app.users (delete_requested_at) WHERE delete_requested_at IS NOT NULL;

CREATE TABLE app.account_delete_limits (
  bucket_key varchar(64) PRIMARY KEY CHECK (bucket_key ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts >= 1)
);

-- Down Migration
-- Only for disposable test or experimental databases: a pending request is dropped (the account simply stays ACTIVE).
DROP TABLE app.account_delete_limits;
DROP INDEX app.users_delete_requested_idx;
ALTER TABLE app.users DROP CONSTRAINT users_delete_request_ck;
ALTER TABLE app.users DROP COLUMN delete_requested_at;
