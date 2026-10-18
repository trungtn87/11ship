-- Up Migration
-- M08: notifications, reminders and state sync. Source: the M08 Functional/UI design (Owner approved 16/10/2026) as summarized in
-- docs/current/M08-implementation-20261018.md. One inbox row per business fact (app.notifications); the channels (push) hang off it
-- (app.notification_pushes), so one event over several channels never makes two inbox entries. Nothing here owns a business
-- state: Order, Delivery, wallet and audit rows are only referenced by identifier and are never touched by archiving or deleting.
--
-- Shared rules of this repository: no IF [NOT] EXISTS on DDL, no CASCADE, no seed data, no GRANT (runtime grants live in the runbooks).

-- 1. Push credentials. A token belongs to ONE session (and so to one account, one app, one phone binding): when the session ends
--    for any reason (logout, replacement by a login on another phone, revocation) the trigger below invalidates the token in the same
--    statement, so a token can never be used for the next account on the same phone.
CREATE TABLE app.notification_push_tokens (
  token_id        uuid         NOT NULL,
  session_id      uuid         NOT NULL,
  user_id         uuid         NOT NULL,
  app             varchar(4)   NOT NULL,
  provider        varchar(8)   NOT NULL,
  token           varchar(4096) NOT NULL,
  token_digest    char(64)     NOT NULL,
  registered_at   timestamptz  NOT NULL,
  last_seen_at    timestamptz  NOT NULL,
  invalidated_at  timestamptz,
  invalid_reason  varchar(24),
  CONSTRAINT notification_push_tokens_pkey PRIMARY KEY (token_id),
  CONSTRAINT notification_push_tokens_session_fk FOREIGN KEY (session_id) REFERENCES app.sessions (session_id) ON DELETE RESTRICT,
  CONSTRAINT notification_push_tokens_user_fk FOREIGN KEY (user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT notification_push_tokens_app_ck CHECK (app IN ('FOOD', 'SHIP')),
  CONSTRAINT notification_push_tokens_provider_ck CHECK (provider IN ('FCM')),
  CONSTRAINT notification_push_tokens_digest_ck CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT notification_push_tokens_invalid_ck CHECK ((invalidated_at IS NULL) = (invalid_reason IS NULL)),
  CONSTRAINT notification_push_tokens_reason_ck CHECK (invalid_reason IS NULL OR invalid_reason IN ('SESSION_ENDED', 'REPLACED', 'UNREGISTERED', 'PROVIDER_REJECTED', 'PERMISSION_DENIED'))
);
-- One live token per session and one live owner per physical token.
CREATE UNIQUE INDEX notification_push_tokens_session_live_uq ON app.notification_push_tokens (session_id) WHERE invalidated_at IS NULL;
CREATE UNIQUE INDEX notification_push_tokens_digest_live_uq ON app.notification_push_tokens (token_digest) WHERE invalidated_at IS NULL;
CREATE INDEX notification_push_tokens_user_idx ON app.notification_push_tokens (user_id, app) WHERE invalidated_at IS NULL;

CREATE FUNCTION app.notification_push_tokens_session_end() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  UPDATE app.notification_push_tokens
     SET invalidated_at = clock_timestamp(), invalid_reason = 'SESSION_ENDED'
   WHERE session_id = NEW.session_id AND invalidated_at IS NULL;
  RETURN NEW;
END
$$;
CREATE TRIGGER sessions_invalidate_push_tokens_trg
  AFTER UPDATE OF revoked_at ON app.sessions
  FOR EACH ROW WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
  EXECUTE FUNCTION app.notification_push_tokens_session_end();

-- 2. Runtime settings an administrator may change (retention, retry, channel switches). One row, written on first change; the
--    application reads the documented defaults while the row is absent. The business timers (5/15/30 minutes, pickup every
--    5 minutes) are NOT here: they belong to M07 and are only displayed.
CREATE TABLE app.notification_config (
  config_id         smallint     NOT NULL,
  push_enabled      boolean      NOT NULL,
  default_sound     boolean      NOT NULL,
  visible_days      integer      NOT NULL,
  purge_days        integer      NOT NULL,
  retry_max_attempts integer     NOT NULL,
  retry_base_seconds integer     NOT NULL,
  version           bigint       NOT NULL,
  updated_by        uuid,
  updated_at        timestamptz  NOT NULL,
  CONSTRAINT notification_config_pkey PRIMARY KEY (config_id),
  CONSTRAINT notification_config_single_ck CHECK (config_id = 1),
  CONSTRAINT notification_config_visible_ck CHECK (visible_days BETWEEN 7 AND 365),
  CONSTRAINT notification_config_purge_ck CHECK (purge_days BETWEEN visible_days AND 1095),
  CONSTRAINT notification_config_retry_ck CHECK (retry_max_attempts BETWEEN 1 AND 10 AND retry_base_seconds BETWEEN 5 AND 3600),
  CONSTRAINT notification_config_updated_by_fk FOREIGN KEY (updated_by) REFERENCES app.users (user_id) ON DELETE RESTRICT
);

-- 3. The inbox. seq is the cursor of the live sync (monotonic per database); dedupe_key makes one fact one row per recipient.
CREATE TABLE app.notifications (
  notification_id   uuid          NOT NULL,
  seq               bigint        GENERATED ALWAYS AS IDENTITY,
  recipient_user_id uuid          NOT NULL,
  app               varchar(4)    NOT NULL,
  kind              varchar(40)   NOT NULL,
  category          varchar(16)   NOT NULL,
  title             varchar(120)  NOT NULL,
  body              varchar(300)  NOT NULL,
  target_type       varchar(16)   NOT NULL,
  target_id         uuid,
  -- Version of the target this fact describes (the resource version of the source event): a push of an older fact is dropped when a newer one exists.
  target_version    bigint        NOT NULL,
  dedupe_key        varchar(160)  NOT NULL,
  source_event_id   uuid,
  item_count        integer       NOT NULL DEFAULT 1,
  -- After this instant the fact is no longer actionable (a new-offer card, a pickup reminder) and no push is sent; the row stays as history.
  valid_until       timestamptz,
  created_at        timestamptz   NOT NULL,
  updated_at        timestamptz   NOT NULL,
  read_at           timestamptz,
  archived_at       timestamptz,
  purge_after       timestamptz   NOT NULL,
  CONSTRAINT notifications_pkey PRIMARY KEY (notification_id),
  CONSTRAINT notifications_seq_uq UNIQUE (seq),
  CONSTRAINT notifications_recipient_fk FOREIGN KEY (recipient_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT notifications_dedupe_uq UNIQUE (recipient_user_id, app, dedupe_key),
  CONSTRAINT notifications_app_ck CHECK (app IN ('FOOD', 'SHIP')),
  CONSTRAINT notifications_category_ck CHECK (category IN ('ORDERS', 'REMINDERS', 'WALLET_PROFILE', 'AVAILABLE')),
  CONSTRAINT notifications_target_ck CHECK (target_type IN ('ORDER', 'DELIVERY', 'WALLET_TXN', 'PROFILE', 'DELIVERY_LIST', 'NONE')),
  CONSTRAINT notifications_target_id_ck CHECK ((target_type IN ('DELIVERY_LIST', 'PROFILE', 'NONE')) OR target_id IS NOT NULL),
  CONSTRAINT notifications_count_ck CHECK (item_count BETWEEN 1 AND 100000),
  CONSTRAINT notifications_time_ck CHECK (updated_at >= created_at AND purge_after > created_at)
);
CREATE INDEX notifications_inbox_idx ON app.notifications (recipient_user_id, app, seq DESC) WHERE archived_at IS NULL;
CREATE INDEX notifications_unread_idx ON app.notifications (recipient_user_id, app) WHERE read_at IS NULL AND archived_at IS NULL;
CREATE INDEX notifications_purge_idx ON app.notifications (purge_after);
CREATE INDEX notifications_target_idx ON app.notifications (recipient_user_id, target_type, target_id);
CREATE INDEX notifications_created_idx ON app.notifications (created_at DESC);

-- 4. Push attempts, one row per (notification, token) with its own retry state and deadline. SENT means the provider accepted the
--    message: it never means the phone showed it or the user read it (those facts are not known and are not recorded).
CREATE TABLE app.notification_pushes (
  push_id          uuid          NOT NULL,
  notification_id  uuid          NOT NULL,
  recipient_user_id uuid         NOT NULL,
  app              varchar(4)    NOT NULL,
  token_id         uuid,
  push_key         varchar(200)  NOT NULL,
  status           varchar(12)   NOT NULL,
  skip_reason      varchar(24),
  attempt_count    integer       NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz   NOT NULL,
  lease_until      timestamptz,
  last_attempt_at  timestamptz,
  sent_at          timestamptz,
  last_error_code  varchar(40),
  last_error_evidence varchar(200),
  expires_at       timestamptz   NOT NULL,
  created_at       timestamptz   NOT NULL,
  CONSTRAINT notification_pushes_pkey PRIMARY KEY (push_id),
  CONSTRAINT notification_pushes_notification_fk FOREIGN KEY (notification_id) REFERENCES app.notifications (notification_id) ON DELETE RESTRICT,
  CONSTRAINT notification_pushes_recipient_fk FOREIGN KEY (recipient_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT notification_pushes_token_fk FOREIGN KEY (token_id) REFERENCES app.notification_push_tokens (token_id) ON DELETE RESTRICT,
  -- At most one push per recipient and push_key. For a new-offer push the key carries delivery and search round; reminders and results carry their notification.
  CONSTRAINT notification_pushes_key_uq UNIQUE (recipient_user_id, app, push_key),
  CONSTRAINT notification_pushes_app_ck CHECK (app IN ('FOOD', 'SHIP')),
  CONSTRAINT notification_pushes_status_ck CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'EXPIRED', 'SKIPPED')),
  CONSTRAINT notification_pushes_skip_ck CHECK ((status = 'SKIPPED') = (skip_reason IS NOT NULL)),
  CONSTRAINT notification_pushes_sent_ck CHECK ((status = 'SENT') = (sent_at IS NOT NULL)),
  CONSTRAINT notification_pushes_attempts_ck CHECK (attempt_count BETWEEN 0 AND 20)
);
CREATE INDEX notification_pushes_due_idx ON app.notification_pushes (next_attempt_at) WHERE status IN ('PENDING', 'SENDING');
CREATE INDEX notification_pushes_notification_idx ON app.notification_pushes (notification_id);
CREATE INDEX notification_pushes_status_idx ON app.notification_pushes (status, created_at DESC);

-- 5. Events already consumed (the outbox is at-least-once): the same event_id is processed once.
CREATE TABLE app.notification_consumed_events (
  event_id     uuid         NOT NULL,
  event_type   varchar(80)  NOT NULL,
  consumed_at  timestamptz  NOT NULL,
  outcome      varchar(24)  NOT NULL,
  CONSTRAINT notification_consumed_events_pkey PRIMARY KEY (event_id)
);
CREATE INDEX notification_consumed_events_age_idx ON app.notification_consumed_events (consumed_at);

-- 6. Reminders that are due, collected from M07 events and sent grouped (several deliveries due together = one notification).
--    Persistent: a worker restart keeps every row and re-checks it, never re-counts the time.
CREATE TABLE app.notification_reminders (
  reminder_id       uuid         NOT NULL,
  event_id          uuid         NOT NULL,
  kind              varchar(12)  NOT NULL,
  recipient_user_id uuid         NOT NULL,
  app               varchar(4)   NOT NULL,
  delivery_id       uuid         NOT NULL,
  assignment_id     uuid,
  due_at            timestamptz  NOT NULL,
  valid_until       timestamptz  NOT NULL,
  status            varchar(16)  NOT NULL,
  resolved_at       timestamptz,
  notification_id   uuid,
  CONSTRAINT notification_reminders_pkey PRIMARY KEY (reminder_id),
  CONSTRAINT notification_reminders_event_uq UNIQUE (event_id),
  CONSTRAINT notification_reminders_recipient_fk FOREIGN KEY (recipient_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT notification_reminders_delivery_fk FOREIGN KEY (delivery_id) REFERENCES app.deliveries (delivery_id) ON DELETE RESTRICT,
  CONSTRAINT notification_reminders_notification_fk FOREIGN KEY (notification_id) REFERENCES app.notifications (notification_id) ON DELETE RESTRICT,
  CONSTRAINT notification_reminders_kind_ck CHECK (kind IN ('SEARCH_5', 'SEARCH_15', 'PICKUP')),
  CONSTRAINT notification_reminders_app_ck CHECK (app IN ('FOOD', 'SHIP')),
  CONSTRAINT notification_reminders_status_ck CHECK (status IN ('PENDING', 'SENT', 'SKIPPED_STALE', 'SKIPPED_INVALID')),
  CONSTRAINT notification_reminders_resolved_ck CHECK ((status = 'PENDING') = (resolved_at IS NULL))
);
CREATE INDEX notification_reminders_due_idx ON app.notification_reminders (due_at) WHERE status = 'PENDING';

-- 7. New-offer pushes: at most one per Shipper, delivery and search round. A round starts when the delivery enters `waiting_driver`
--    (creation, recall, a Shipper giving it back) and is identified by the delivery version of that event; the delivery's own deadline is never touched.
CREATE TABLE app.notification_offer_rounds (
  delivery_id    uuid         NOT NULL,
  round_version  bigint       NOT NULL,
  user_id        uuid         NOT NULL,
  notified_at    timestamptz  NOT NULL,
  CONSTRAINT notification_offer_rounds_pkey PRIMARY KEY (delivery_id, round_version, user_id),
  CONSTRAINT notification_offer_rounds_delivery_fk FOREIGN KEY (delivery_id) REFERENCES app.deliveries (delivery_id) ON DELETE RESTRICT,
  CONSTRAINT notification_offer_rounds_user_fk FOREIGN KEY (user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT
);

-- 8. Per-account settings by app. Defaults (absent row): every group on, sound and vibration on. Turning sound off never stops a push or an order.
CREATE TABLE app.notification_settings (
  user_id         uuid         NOT NULL,
  app             varchar(4)   NOT NULL,
  orders          boolean      NOT NULL,
  reminders       boolean      NOT NULL,
  wallet_profile  boolean      NOT NULL,
  available       boolean      NOT NULL,
  sound           boolean      NOT NULL,
  vibrate         boolean      NOT NULL,
  updated_at      timestamptz  NOT NULL,
  CONSTRAINT notification_settings_pkey PRIMARY KEY (user_id, app),
  CONSTRAINT notification_settings_user_fk FOREIGN KEY (user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT notification_settings_app_ck CHECK (app IN ('FOOD', 'SHIP'))
);

-- Down Migration
-- Only for disposable test or experimental databases. Reverse dependency order, no CASCADE, no IF EXISTS.
DROP TABLE app.notification_settings;
DROP TABLE app.notification_offer_rounds;
DROP TABLE app.notification_reminders;
DROP TABLE app.notification_consumed_events;
DROP TABLE app.notification_pushes;
DROP TABLE app.notifications;
DROP TABLE app.notification_config;
DROP TRIGGER sessions_invalidate_push_tokens_trg ON app.sessions;
DROP FUNCTION app.notification_push_tokens_session_end();
DROP TABLE app.notification_push_tokens;
