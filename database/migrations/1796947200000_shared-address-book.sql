-- Up Migration
-- G07 / #222: extend the existing M05 address book without replacing or deleting legacy data.
ALTER TABLE app.customer_addresses
  ADD COLUMN display_name varchar(50),
  ADD COLUMN is_pickup_default boolean NOT NULL DEFAULT false,
  ADD COLUMN is_delivery_default boolean NOT NULL DEFAULT false;

ALTER TABLE app.customer_addresses
  ADD CONSTRAINT customer_addresses_display_name_ck
    CHECK (display_name IS NULL OR char_length(btrim(display_name)) BETWEEN 1 AND 50),
  ADD CONSTRAINT customer_addresses_pickup_default_active_ck
    CHECK (NOT (is_pickup_default AND NOT is_active)),
  ADD CONSTRAINT customer_addresses_delivery_default_active_ck
    CHECK (NOT (is_delivery_default AND NOT is_active));

-- The former single default was the Food delivery default. Preserve that meaning.
UPDATE app.customer_addresses SET is_delivery_default = is_default WHERE is_default;

CREATE UNIQUE INDEX customer_addresses_one_pickup_default_uq
  ON app.customer_addresses (customer_id) WHERE is_pickup_default AND is_active;
CREATE UNIQUE INDEX customer_addresses_one_delivery_default_uq
  ON app.customer_addresses (customer_id) WHERE is_delivery_default AND is_active;

CREATE INDEX customer_addresses_search_idx
  ON app.customer_addresses (customer_id, updated_at DESC, id) WHERE is_active;

-- #229 M05 -> M10 -> M07: keep route guidance separate from the order/item note.
ALTER TABLE app.orders ADD COLUMN delivery_note varchar(200);
ALTER TABLE app.orders ADD CONSTRAINT orders_delivery_note_ck
  CHECK (delivery_note IS NULL OR char_length(btrim(delivery_note)) BETWEEN 1 AND 200);
ALTER TABLE app.deliveries ADD COLUMN dropoff_note varchar(200);
ALTER TABLE app.deliveries ADD CONSTRAINT deliveries_dropoff_note_ck
  CHECK (dropoff_note IS NULL OR char_length(btrim(dropoff_note)) BETWEEN 1 AND 200);

CREATE FUNCTION app.address_note_snapshot_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'orders' AND to_jsonb(NEW)->'delivery_note' IS DISTINCT FROM to_jsonb(OLD)->'delivery_note' THEN
    RAISE EXCEPTION 'ORDER_DELIVERY_NOTE_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_TABLE_NAME = 'deliveries' AND to_jsonb(NEW)->'dropoff_note' IS DISTINCT FROM to_jsonb(OLD)->'dropoff_note' THEN
    RAISE EXCEPTION 'DELIVERY_DROPOFF_NOTE_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER orders_delivery_note_guard BEFORE UPDATE ON app.orders FOR EACH ROW EXECUTE FUNCTION app.address_note_snapshot_guard();
CREATE TRIGGER deliveries_dropoff_note_guard BEFORE UPDATE ON app.deliveries FOR EACH ROW EXECUTE FUNCTION app.address_note_snapshot_guard();

-- Down Migration
-- Disposable databases only. Refuse rollback when the new contract contains data the old one cannot represent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM app.customer_addresses
     WHERE display_name IS NOT NULL OR is_pickup_default OR is_delivery_default IS DISTINCT FROM is_default
  ) THEN
    RAISE EXCEPTION 'cannot roll back shared address book: new address data exists';
  END IF;
  IF EXISTS (SELECT 1 FROM app.orders WHERE delivery_note IS NOT NULL)
     OR EXISTS (SELECT 1 FROM app.deliveries WHERE dropoff_note IS NOT NULL) THEN
    RAISE EXCEPTION 'cannot roll back shared address book: order guidance snapshots exist';
  END IF;
END
$$;

DROP TRIGGER deliveries_dropoff_note_guard ON app.deliveries;
DROP TRIGGER orders_delivery_note_guard ON app.orders;
DROP FUNCTION app.address_note_snapshot_guard();
ALTER TABLE app.deliveries DROP CONSTRAINT deliveries_dropoff_note_ck, DROP COLUMN dropoff_note;
ALTER TABLE app.orders DROP CONSTRAINT orders_delivery_note_ck, DROP COLUMN delivery_note;
DROP INDEX app.customer_addresses_search_idx;
DROP INDEX app.customer_addresses_one_delivery_default_uq;
DROP INDEX app.customer_addresses_one_pickup_default_uq;
ALTER TABLE app.customer_addresses
  DROP CONSTRAINT customer_addresses_delivery_default_active_ck,
  DROP CONSTRAINT customer_addresses_pickup_default_active_ck,
  DROP CONSTRAINT customer_addresses_display_name_ck,
  DROP COLUMN is_delivery_default,
  DROP COLUMN is_pickup_default,
  DROP COLUMN display_name;
