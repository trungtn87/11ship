-- Up Migration
-- M05: the customer record and the delivery address book of a customer. Contract: docs/current/11Ship-M05-design-approved-v1.0.md
-- sections 2, 5 and 6 (Owner approved 2026-10-15). Two tables, no seed data, no backfill, no trigger, no function. Applied
-- migrations are never edited: this is a new file after the Shipper management one and it references only app.users.
--
-- Rules shared with every migration of this repository: no IF [NOT] EXISTS on DDL, no CASCADE, no GRANT (runtime grants live in
-- ops/selfhosted/02-runtime-grants.sql and ops/runbooks/render-supabase-staging.md). If an object already exists the migration
-- fails and rolls back as a whole.
--
-- app.customers has NO login field: the account is the M01 one (app.users). The row is created ONCE per user, lazily, by the
-- M05 service the first time the customer needs it (GET /v1/customers/me or the first address), never by a migration.
-- app.customer_addresses holds the address book. An address is never physically deleted: a delete sets is_active = false
-- (and is_default = false), so ids stay valid for the snapshots a later order module keeps.
--
-- Two guarantees live in the database, not only in the service:
--   * at most ONE active default address per customer (partial unique index customer_addresses_one_default_uq), so two devices
--     that both set a default can never leave two of them;
--   * latitude and longitude are both present and in range, or both NULL (no invented position).
-- `label` stores the code HOME / OFFICE / OTHER (the app shows Nhà / Cơ quan / Khác).
-- `version` is an optimistic-concurrency counter of the row; it starts at 1 and every change raises it by exactly 1.

-- ---------------------------------------------------------------------------------------------------
-- app.customers
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.customers (
  id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT customers_pkey PRIMARY KEY (id),
  CONSTRAINT customers_user_uq UNIQUE (user_id),
  CONSTRAINT customers_user_fk FOREIGN KEY (user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT customers_time_order_ck CHECK (updated_at >= created_at)
);

-- ---------------------------------------------------------------------------------------------------
-- app.customer_addresses
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.customer_addresses (
  id uuid NOT NULL,
  customer_id uuid NOT NULL,
  label varchar(8) NOT NULL,
  recipient_name varchar(120),
  -- E.164 (the Auth phone normalization), the number the shipper calls: it may differ from the account phone.
  contact_phone varchar(16) NOT NULL,
  address_description varchar(300) NOT NULL,
  latitude double precision,
  longitude double precision,
  delivery_note varchar(300),
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT customer_addresses_pkey PRIMARY KEY (id),
  CONSTRAINT customer_addresses_customer_fk FOREIGN KEY (customer_id) REFERENCES app.customers (id) ON DELETE RESTRICT,
  CONSTRAINT customer_addresses_label_ck CHECK (label IN ('HOME', 'OFFICE', 'OTHER')),
  CONSTRAINT customer_addresses_recipient_name_ck CHECK (recipient_name IS NULL OR char_length(btrim(recipient_name)) BETWEEN 1 AND 120),
  CONSTRAINT customer_addresses_contact_phone_ck CHECK (contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT customer_addresses_description_ck CHECK (char_length(btrim(address_description)) BETWEEN 1 AND 300),
  CONSTRAINT customer_addresses_note_ck CHECK (delivery_note IS NULL OR char_length(btrim(delivery_note)) BETWEEN 1 AND 300),
  CONSTRAINT customer_addresses_position_ck CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude IS NOT NULL AND longitude IS NOT NULL
        AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  ),
  -- A deleted address is never the default.
  CONSTRAINT customer_addresses_default_active_ck CHECK (NOT (is_default AND NOT is_active)),
  -- 9007199254740991 is Number.MAX_SAFE_INTEGER: the version always fits a JavaScript integer.
  CONSTRAINT customer_addresses_version_ck CHECK (version BETWEEN 1 AND 9007199254740991),
  CONSTRAINT customer_addresses_time_order_ck CHECK (updated_at >= created_at)
);

-- At most one active default address per customer.
CREATE UNIQUE INDEX customer_addresses_one_default_uq ON app.customer_addresses (customer_id) WHERE is_default AND is_active;

-- The address book of one customer: active rows, default first, then most recently updated.
CREATE INDEX customer_addresses_book_idx ON app.customer_addresses (customer_id, is_default DESC, updated_at DESC, id) WHERE is_active;

-- Down Migration
-- Only for disposable test or experimental databases. Remote databases are fixed forward with a new migration; never run this
-- there. It refuses to run once an address or a customer exists: dropping them would destroy customer data. No CASCADE and no
-- IF EXISTS: it fails loudly if anything is missing instead of hiding drift. The indexes go with their table.
DO $$
BEGIN
  IF (SELECT count(*) FROM app.customer_addresses) > 0 THEN
    RAISE EXCEPTION 'cannot roll back M05: address rows exist';
  END IF;
  IF (SELECT count(*) FROM app.customers) > 0 THEN
    RAISE EXCEPTION 'cannot roll back M05: customer rows exist';
  END IF;
END
$$;

DROP TABLE app.customer_addresses;
DROP TABLE app.customers;
