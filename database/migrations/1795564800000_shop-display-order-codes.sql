-- Up Migration
-- M10/M07 display-only shop codes. Existing orders.code/deliveries.code and UUIDs stay unchanged.
-- A single per-shop counter is used by food orders and root DIRECT deliveries.
CREATE TABLE app.shop_public_ids (
  shop_id uuid PRIMARY KEY REFERENCES app.shops(shop_id) ON DELETE RESTRICT,
  shop_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL
);

CREATE TABLE app.shop_display_counters (
  shop_id uuid PRIMARY KEY REFERENCES app.shops(shop_id) ON DELETE RESTRICT,
  last_number bigint NOT NULL CHECK (last_number >= 0)
);

CREATE TABLE app.shop_display_numbers (
  shop_id uuid NOT NULL REFERENCES app.shops(shop_id) ON DELETE RESTRICT,
  resource_kind varchar(8) NOT NULL CHECK (resource_kind IN ('ORDER', 'DIRECT')),
  resource_id uuid NOT NULL,
  order_number bigint NOT NULL CHECK (order_number >= 1),
  PRIMARY KEY (resource_kind, resource_id),
  UNIQUE (shop_id, order_number)
);

-- Existing shop numbers are allocated deterministically before any new writes.
INSERT INTO app.shop_public_ids (shop_id)
SELECT shop_id FROM app.shops ORDER BY created_at, shop_id;

-- Backfill immutable aliases (not physical codes). One sequence across both kinds.
WITH existing AS (
  SELECT o.shop_id, 'ORDER'::varchar(8) AS resource_kind, o.order_id AS resource_id, o.created_at
    FROM app.orders o
  UNION ALL
  SELECT d.shop_id, 'DIRECT'::varchar(8), d.delivery_id, d.created_at
    FROM app.deliveries d
   WHERE d.source = 'DIRECT' AND d.previous_delivery_id IS NULL
), numbered AS (
  SELECT shop_id, resource_kind, resource_id,
         row_number() OVER (PARTITION BY shop_id ORDER BY created_at, resource_kind, resource_id) AS order_number
    FROM existing
)
INSERT INTO app.shop_display_numbers (shop_id, resource_kind, resource_id, order_number)
SELECT shop_id, resource_kind, resource_id, order_number FROM numbered;

INSERT INTO app.shop_display_counters (shop_id, last_number)
SELECT s.shop_id, COALESCE(MAX(n.order_number), 0)
  FROM app.shops s LEFT JOIN app.shop_display_numbers n ON n.shop_id = s.shop_id
 GROUP BY s.shop_id;

-- New shops receive their fixed K-number immediately on registration, even before an order.
CREATE FUNCTION app.shop_display_new_shop()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $
BEGIN
  INSERT INTO app.shop_public_ids (shop_id) VALUES (NEW.shop_id);
  INSERT INTO app.shop_display_counters (shop_id, last_number) VALUES (NEW.shop_id, 0);
  RETURN NEW;
END;
$;
CREATE TRIGGER shop_display_new_shop AFTER INSERT ON app.shops
FOR EACH ROW EXECUTE FUNCTION app.shop_display_new_shop();

-- Allocated in the same transaction as INSERT app.orders or app.deliveries.
-- ON CONFLICT DO UPDATE serializes concurrent requests by shop, never MAX()+1.
CREATE FUNCTION app.allocate_shop_display_number(p_shop uuid, p_kind varchar, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE next_number bigint;
BEGIN
  INSERT INTO app.shop_public_ids (shop_id) VALUES (p_shop) ON CONFLICT (shop_id) DO NOTHING;
  INSERT INTO app.shop_display_counters (shop_id, last_number)
    VALUES (p_shop, 1)
    ON CONFLICT (shop_id) DO UPDATE
      SET last_number = app.shop_display_counters.last_number + 1
    RETURNING last_number INTO next_number;
  INSERT INTO app.shop_display_numbers (shop_id, resource_kind, resource_id, order_number)
    VALUES (p_shop, p_kind, p_id, next_number);
END;
$$;

CREATE FUNCTION app.shop_order_display_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  PERFORM app.allocate_shop_display_number(NEW.shop_id, 'ORDER', NEW.order_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER shop_order_display_insert AFTER INSERT ON app.orders
FOR EACH ROW EXECUTE FUNCTION app.shop_order_display_insert();

CREATE FUNCTION app.shop_delivery_display_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NEW.source = 'DIRECT' AND NEW.previous_delivery_id IS NULL THEN
    PERFORM app.allocate_shop_display_number(NEW.shop_id, 'DIRECT', NEW.delivery_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER shop_delivery_display_insert AFTER INSERT ON app.deliveries
FOR EACH ROW EXECUTE FUNCTION app.shop_delivery_display_insert();

-- SQL functions used only in scoped views/queries; a recall keeps its original number.
CREATE FUNCTION app.shop_display_order(p_order uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
 SELECT 'K' || lpad(s.shop_number::text, greatest(2, length(s.shop_number::text)), '0') || '-' || lpad(n.order_number::text, greatest(4, length(n.order_number::text)), '0')
   FROM app.shop_display_numbers n JOIN app.shop_public_ids s ON s.shop_id = n.shop_id
  WHERE n.resource_kind = 'ORDER' AND n.resource_id = p_order
$$;

CREATE FUNCTION app.shop_display_direct(p_delivery uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
 SELECT 'K' || lpad(s.shop_number::text, greatest(2, length(s.shop_number::text)), '0') || '-' || lpad(n.order_number::text, greatest(4, length(n.order_number::text)), '0')
   FROM app.shop_display_numbers n JOIN app.shop_public_ids s ON s.shop_id = n.shop_id
  WHERE n.resource_kind = 'DIRECT' AND n.resource_id = p_delivery
$$;

CREATE FUNCTION app.shop_display_delivery(p_delivery uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  WITH RECURSIVE predecessors AS (
    SELECT delivery_id, previous_delivery_id, order_id, source, 0 AS depth
      FROM app.deliveries WHERE delivery_id = p_delivery
    UNION ALL
    SELECT d.delivery_id, d.previous_delivery_id, d.order_id, d.source, p.depth + 1
      FROM app.deliveries d JOIN predecessors p ON d.delivery_id = p.previous_delivery_id
     WHERE p.depth < 100
  )
  SELECT CASE WHEN p.source = 'ORDER' THEN app.shop_display_order(p.order_id)
              ELSE app.shop_display_direct(p.delivery_id) END
    FROM predecessors p
   WHERE p.previous_delivery_id IS NULL OR p.source = 'ORDER'
   ORDER BY p.depth DESC LIMIT 1
$$;

-- Run-time role cannot write mapping/counters directly. SECURITY DEFINER triggers
-- perform allocation; bounded API queries may execute read helpers.
REVOKE ALL ON TABLE app.shop_public_ids, app.shop_display_counters, app.shop_display_numbers FROM PUBLIC;
REVOKE ALL ON FUNCTION app.allocate_shop_display_number(uuid, varchar, uuid), app.shop_order_display_insert(),
  app.shop_delivery_display_insert(), app.shop_display_new_shop(), app.shop_display_order(uuid), app.shop_display_direct(uuid),
  app.shop_display_delivery(uuid) FROM PUBLIC;

-- The runtime role gets EXECUTE through ops/selfhosted/03-runtime-function-grants.sql.
-- Keeping role-specific grants outside the schema migration supports non-selfhosted
-- database environments and matches the existing runtime privilege workflow.

-- Down Migration
-- Do not lose business aliases after any orders or deliveries exist.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM app.shop_display_numbers) THEN
    RAISE EXCEPTION 'SHOP_DISPLAY_CODES_DOWN_REFUSED: data exists' USING ERRCODE = 'restrict_violation';
  END IF;
END;
$guard$;

DROP TRIGGER shop_delivery_display_insert ON app.deliveries;
DROP TRIGGER shop_display_new_shop ON app.shops;
DROP TRIGGER shop_order_display_insert ON app.orders;
DROP FUNCTION app.shop_display_delivery(uuid);
DROP FUNCTION app.shop_display_direct(uuid);
DROP FUNCTION app.shop_display_order(uuid);
DROP FUNCTION app.shop_delivery_display_insert();
DROP FUNCTION app.shop_display_new_shop();
DROP FUNCTION app.shop_order_display_insert();
DROP FUNCTION app.allocate_shop_display_number(uuid, varchar, uuid);
DROP TABLE app.shop_display_numbers;
DROP TABLE app.shop_display_counters;
DROP TABLE app.shop_public_ids;
