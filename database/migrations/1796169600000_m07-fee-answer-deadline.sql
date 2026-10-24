-- Up Migration
-- M07 Owner decision 2026-10-24: the payer has its own, configurable time to answer a fee a Shipper proposed (default 5 minutes, set by SYSTEM in
-- Cài đặt › Đơn hàng "Thời gian trả lời đề xuất phí"); the deadline is stored per counter-offer and is never later than the search deadline. An unanswered offer
-- is dropped, the earlier fee stays and the search goes on. The events also record who the payer is and a confirmation given by the shop for a payer
-- without an app, apart from the actor. Forward-only: existing rows are untouched and constraints are only widened.

-- ---------------------------------------------------------------------------------------------------
-- app.order_parameters: the settings of the "Đơn hàng" group (one row per parameter) and their append-only change log
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.order_parameters (
  param_key varchar(32) NOT NULL,
  int_value bigint NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL,

  CONSTRAINT order_parameters_pkey PRIMARY KEY (param_key),
  CONSTRAINT order_parameters_key_ck CHECK (param_key IN ('fee_answer_minutes')),
  CONSTRAINT order_parameters_value_ck CHECK (int_value >= 1 AND int_value <= 1440),
  CONSTRAINT order_parameters_version_ck CHECK (version >= 1),
  CONSTRAINT order_parameters_updated_by_fk FOREIGN KEY (updated_by) REFERENCES app.users (user_id)
);

INSERT INTO app.order_parameters (param_key, int_value, version, updated_by, updated_at)
VALUES ('fee_answer_minutes', 5, 1, NULL, date_trunc('milliseconds', clock_timestamp()));

CREATE TABLE app.order_parameter_changes (
  change_id uuid NOT NULL,
  param_key varchar(32) NOT NULL,
  old_value bigint NOT NULL,
  new_value bigint NOT NULL,
  changed_by uuid NOT NULL,
  changed_at timestamptz NOT NULL,
  request_id uuid,

  CONSTRAINT order_parameter_changes_pkey PRIMARY KEY (change_id),
  CONSTRAINT order_parameter_changes_key_fk FOREIGN KEY (param_key) REFERENCES app.order_parameters (param_key),
  CONSTRAINT order_parameter_changes_by_fk FOREIGN KEY (changed_by) REFERENCES app.users (user_id),
  CONSTRAINT order_parameter_changes_values_ck CHECK (old_value >= 1 AND new_value >= 1 AND old_value <> new_value)
);
CREATE INDEX order_parameter_changes_idx ON app.order_parameter_changes (changed_at DESC, change_id);

CREATE FUNCTION app.order_parameter_changes_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.order_parameter_changes is append-only (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER order_parameter_changes_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON app.order_parameter_changes
  FOR EACH STATEMENT EXECUTE FUNCTION app.order_parameter_changes_reject_mutation();

-- ---------------------------------------------------------------------------------------------------
-- The answer deadline of a counter-offer, stored with the offer. NULL when no counter-offer is waiting (and for every row that existed before: those keep
-- the search deadline as their only deadline).
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE app.shipping_fee_agreements ADD COLUMN answer_expires_at timestamptz;
ALTER TABLE app.shipping_fee_agreements ADD CONSTRAINT shipping_fee_agreements_answer_deadline_ck CHECK (
  answer_expires_at IS NULL OR (answer_expires_at > created_at AND answer_expires_at <= expires_at)
);

-- The event of an unanswered counter-offer, who the payer was, and who a confirmation was given for (the actor stays the person who acted).
ALTER TABLE app.shipping_fee_agreement_events ADD COLUMN on_behalf_of varchar(8);
ALTER TABLE app.shipping_fee_agreement_events ADD COLUMN fee_payer varchar(8);
ALTER TABLE app.shipping_fee_agreement_events ADD CONSTRAINT shipping_fee_agreement_events_on_behalf_ck CHECK (on_behalf_of IS NULL OR on_behalf_of = 'CUSTOMER');
ALTER TABLE app.shipping_fee_agreement_events ADD CONSTRAINT shipping_fee_agreement_events_fee_payer_ck CHECK (fee_payer IS NULL OR fee_payer IN ('CUSTOMER', 'SHOP'));
ALTER TABLE app.shipping_fee_agreement_events DROP CONSTRAINT shipping_fee_agreement_events_type_ck;
ALTER TABLE app.shipping_fee_agreement_events ADD CONSTRAINT shipping_fee_agreement_events_type_ck CHECK (event_type IN (
  'STANDARD_CREATED', 'PROPOSED', 'DRIVER_ACCEPTED', 'DRIVER_SKIPPED', 'COUNTERED', 'COUNTER_ACCEPTED', 'COUNTER_REJECTED', 'COUNTER_EXPIRED',
  'CUSTOMER_CONFIRMED', 'CUSTOMER_DECLINED', 'EXPIRED', 'LOCKED', 'ADMIN_ADJUSTED', 'DEADLINE_EXTENDED'
));

-- Down Migration
-- Preserve immutable history; use a corrective migration after release.
DO $$ BEGIN RAISE EXCEPTION 'M07 2026-10-24: rollback requires a forward corrective migration'; END $$;
