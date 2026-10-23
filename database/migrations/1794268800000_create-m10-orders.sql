-- Up Migration
-- M10 (docs/current/M10-implementation-20261018.md): the customer's cart, the food Order with its snapshots, its lines, its history, and the link
-- from a delivery (M07) to the Order it carries. The Order and the delivery have their OWN states; this migration only ties them with the integrity rules
-- the Owner approved (one active delivery per Order, ended Order => no active delivery, completed Order => a completed delivery, no empty confirmation).
--
-- ADDITIVE: new tables, functions and triggers, plus ONE foreign key on app.deliveries(order_id) (asserted: no delivery carries an order id yet, because
-- M07 refused order-based calls until now). Nothing is dropped, truncated or rewritten; no CASCADE; earlier migrations are not edited.
-- Business rows are never deleted (triggers); the cart is working data and may be replaced or removed.

-- ---------------------------------------------------------------------------------------------------
-- app.customer_carts: ONE cart per customer account, for ONE shop (a cart of another shop replaces it only after the customer agreed in the app).
-- It is what the app shows after a restart; prices and availability are never stored here as truth: the server re-reads them when the order is sent.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.customer_carts (
  user_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  lines jsonb NOT NULL,
  note varchar(200),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT customer_carts_pkey PRIMARY KEY (user_id),
  CONSTRAINT customer_carts_user_fk FOREIGN KEY (user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT customer_carts_shop_fk FOREIGN KEY (shop_id) REFERENCES app.shops (shop_id) ON DELETE RESTRICT,
  CONSTRAINT customer_carts_lines_ck CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) BETWEEN 1 AND 40),
  CONSTRAINT customer_carts_version_ck CHECK (version >= 1),
  CONSTRAINT customer_carts_time_ck CHECK (updated_at >= created_at)
);

-- ---------------------------------------------------------------------------------------------------
-- app.orders
-- ---------------------------------------------------------------------------------------------------
-- status: PENDING_CONFIRMATION -> PREPARING -> COMPLETED | CANCELLED_BY_SHOP | NOT_COMPLETED, or PENDING_CONFIRMATION -> CANCELLED_BY_CUSTOMER | REJECTED_BY_SHOP.
-- "Món đã sẵn sàng" is the independent mark ready_at (it is not a status); the delivery state lives on app.deliveries.
-- Everything the customer chose and the shop was (name, phone, address, dishes, prices, schedule) is a SNAPSHOT of the moment of ordering: a later change of the menu,
-- the address book or the shop profile does not rewrite it. client_ref is the customer's own id of the attempt: it makes sending the same order twice (a lost reply, a
-- reinstall) the same Order, even beyond the Idempotency-Key retention.
CREATE TABLE app.orders (
  order_id uuid NOT NULL,
  code varchar(16) NOT NULL,
  client_ref uuid NOT NULL,
  customer_user_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  status varchar(24) NOT NULL,
  shop_name varchar(120) NOT NULL,
  shop_phone varchar(20) NOT NULL,
  shop_address_text varchar(300) NOT NULL,
  recipient_name varchar(80) NOT NULL,
  recipient_phone varchar(20) NOT NULL,
  address_text varchar(300) NOT NULL,
  address_lat double precision,
  address_lng double precision,
  source_address_id uuid,
  note varchar(200),
  scheduled_for timestamptz,
  -- Whole VND. Original = the dishes as ordered (never changes); current = after the shop's edits (editable only before confirmation).
  items_original_total_vnd bigint NOT NULL,
  items_total_vnd bigint NOT NULL,
  paid_vnd bigint NOT NULL DEFAULT 0,
  -- The fee the customer was shown (M06) when sending, if one could be priced: NULL = "chưa xác định", never 0. Not a promise: the delivery fixes the fee.
  fee_estimate_vnd bigint,
  fee_estimate_distance_m integer,
  edited_at timestamptz,
  change_reason varchar(300),
  confirmed_at timestamptz,
  ready_at timestamptz,
  schedule_reminded_at timestamptz,
  ended_at timestamptz,
  end_actor varchar(8),
  end_reason varchar(300),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT orders_pkey PRIMARY KEY (order_id),
  CONSTRAINT orders_code_uq UNIQUE (code),
  CONSTRAINT orders_client_ref_uq UNIQUE (customer_user_id, client_ref),
  CONSTRAINT orders_customer_fk FOREIGN KEY (customer_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT orders_shop_fk FOREIGN KEY (shop_id) REFERENCES app.shops (shop_id) ON DELETE RESTRICT,
  CONSTRAINT orders_address_fk FOREIGN KEY (source_address_id) REFERENCES app.customer_addresses (id) ON DELETE RESTRICT,
  CONSTRAINT orders_status_ck CHECK (status IN ('PENDING_CONFIRMATION', 'PREPARING', 'COMPLETED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SHOP', 'REJECTED_BY_SHOP', 'NOT_COMPLETED')),
  CONSTRAINT orders_end_actor_ck CHECK (end_actor IS NULL OR end_actor IN ('CUSTOMER', 'SHOP', 'ADMIN', 'SYSTEM')),
  CONSTRAINT orders_point_ck CHECK (
    (address_lat IS NULL) = (address_lng IS NULL)
    AND (address_lat IS NULL OR (address_lat BETWEEN -90 AND 90 AND address_lng BETWEEN -180 AND 180))
  ),
  CONSTRAINT orders_money_ck CHECK (
    items_original_total_vnd BETWEEN 1 AND 9007199254740991
    AND items_total_vnd BETWEEN 0 AND 9007199254740991
    AND paid_vnd BETWEEN 0 AND items_total_vnd
    AND (fee_estimate_vnd IS NULL OR fee_estimate_vnd BETWEEN 0 AND 10000000)
    AND (fee_estimate_distance_m IS NULL OR fee_estimate_distance_m >= 0)
  ),
  -- Confirmed exactly when the Order went (or passed) through PREPARING; ended exactly when it is in an end status.
  CONSTRAINT orders_confirmed_ck CHECK ((confirmed_at IS NOT NULL) = (status IN ('PREPARING', 'COMPLETED', 'CANCELLED_BY_SHOP', 'NOT_COMPLETED'))),
  CONSTRAINT orders_ended_ck CHECK ((ended_at IS NOT NULL) = (status IN ('COMPLETED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SHOP', 'REJECTED_BY_SHOP', 'NOT_COMPLETED'))),
  CONSTRAINT orders_end_actor_present_ck CHECK ((end_actor IS NOT NULL) = (ended_at IS NOT NULL)),
  -- A reason is mandatory for the shop's refusal / cancellation, for closing as not completed, and for confirming an order whose content or amount was edited.
  CONSTRAINT orders_reason_ck CHECK (status NOT IN ('REJECTED_BY_SHOP', 'CANCELLED_BY_SHOP', 'NOT_COMPLETED') OR (end_reason IS NOT NULL AND btrim(end_reason) <> '')),
  CONSTRAINT orders_change_reason_ck CHECK (edited_at IS NULL OR confirmed_at IS NULL OR (change_reason IS NOT NULL AND btrim(change_reason) <> '')),
  CONSTRAINT orders_ready_ck CHECK (ready_at IS NULL OR confirmed_at IS NOT NULL),
  CONSTRAINT orders_schedule_ck CHECK (schedule_reminded_at IS NULL OR scheduled_for IS NOT NULL),
  CONSTRAINT orders_version_ck CHECK (version >= 1),
  CONSTRAINT orders_time_ck CHECK (updated_at >= created_at)
);
CREATE INDEX orders_shop_idx ON app.orders (shop_id, created_at DESC);
CREATE INDEX orders_customer_idx ON app.orders (customer_user_id, created_at DESC);
CREATE INDEX orders_schedule_idx ON app.orders (scheduled_for) WHERE status = 'PREPARING' AND scheduled_for IS NOT NULL AND schedule_reminded_at IS NULL;

-- ---------------------------------------------------------------------------------------------------
-- app.order_items: the dishes of an Order. orig_* is the line as ordered and never changes; unit_price_vnd / quantity / removed_at are the shop's edits, possible
-- only while the Order waits for confirmation (the trigger below). Name and note are snapshots.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.order_items (
  line_id uuid NOT NULL,
  order_id uuid NOT NULL,
  line_no smallint NOT NULL,
  menu_item_id uuid NOT NULL,
  name varchar(120) NOT NULL,
  note varchar(200),
  orig_unit_price_vnd bigint NOT NULL,
  orig_quantity integer NOT NULL,
  unit_price_vnd bigint NOT NULL,
  quantity integer NOT NULL,
  removed_at timestamptz,
  created_at timestamptz NOT NULL,

  CONSTRAINT order_items_pkey PRIMARY KEY (line_id),
  CONSTRAINT order_items_line_uq UNIQUE (order_id, line_no),
  CONSTRAINT order_items_order_fk FOREIGN KEY (order_id) REFERENCES app.orders (order_id) ON DELETE RESTRICT,
  CONSTRAINT order_items_menu_item_fk FOREIGN KEY (menu_item_id) REFERENCES app.menu_items (item_id) ON DELETE RESTRICT,
  CONSTRAINT order_items_line_no_ck CHECK (line_no BETWEEN 1 AND 40),
  CONSTRAINT order_items_qty_ck CHECK (orig_quantity BETWEEN 1 AND 99 AND quantity BETWEEN 1 AND 99),
  CONSTRAINT order_items_price_ck CHECK (orig_unit_price_vnd BETWEEN 1 AND 99999999 AND unit_price_vnd BETWEEN 1 AND 99999999)
);

-- ---------------------------------------------------------------------------------------------------
-- app.order_events: the history (append-only): who did what, when, and for edits the before / after.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.order_events (
  event_id uuid NOT NULL,
  order_id uuid NOT NULL,
  type varchar(48) NOT NULL,
  actor_type varchar(8) NOT NULL,
  actor_id uuid,
  note varchar(480),
  details jsonb,
  at timestamptz NOT NULL,

  CONSTRAINT order_events_pkey PRIMARY KEY (event_id),
  CONSTRAINT order_events_order_fk FOREIGN KEY (order_id) REFERENCES app.orders (order_id) ON DELETE RESTRICT,
  CONSTRAINT order_events_actor_ck CHECK (actor_type IN ('CUSTOMER', 'SHOP', 'ADMIN', 'SYSTEM'))
);
CREATE INDEX order_events_order_idx ON app.order_events (order_id, at, event_id);

-- ---------------------------------------------------------------------------------------------------
-- Rules enforced by the database itself
-- ---------------------------------------------------------------------------------------------------
CREATE FUNCTION app.orders_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.orders is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.order_id <> OLD.order_id OR NEW.code <> OLD.code OR NEW.client_ref <> OLD.client_ref OR NEW.customer_user_id <> OLD.customer_user_id
     OR NEW.shop_id <> OLD.shop_id OR NEW.shop_name <> OLD.shop_name OR NEW.shop_phone <> OLD.shop_phone OR NEW.shop_address_text <> OLD.shop_address_text
     OR NEW.recipient_name <> OLD.recipient_name OR NEW.recipient_phone <> OLD.recipient_phone OR NEW.address_text <> OLD.address_text
     OR NEW.address_lat IS DISTINCT FROM OLD.address_lat OR NEW.address_lng IS DISTINCT FROM OLD.address_lng
     OR NEW.source_address_id IS DISTINCT FROM OLD.source_address_id OR NEW.note IS DISTINCT FROM OLD.note OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
     OR NEW.items_original_total_vnd <> OLD.items_original_total_vnd OR NEW.fee_estimate_vnd IS DISTINCT FROM OLD.fee_estimate_vnd
     OR NEW.fee_estimate_distance_m IS DISTINCT FROM OLD.fee_estimate_distance_m OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'ORDER_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'ORDER_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PENDING_CONFIRMATION' AND NEW.status IN ('PREPARING', 'CANCELLED_BY_CUSTOMER', 'REJECTED_BY_SHOP'))
    OR (OLD.status = 'PREPARING' AND NEW.status IN ('COMPLETED', 'CANCELLED_BY_SHOP', 'NOT_COMPLETED'))
  ) THEN
    RAISE EXCEPTION 'ORDER_STATE_TRANSITION: % -> %', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  -- A finished Order changes nothing.
  IF OLD.status IN ('COMPLETED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SHOP', 'REJECTED_BY_SHOP', 'NOT_COMPLETED') THEN
    RAISE EXCEPTION 'ORDER_TERMINAL' USING ERRCODE = 'restrict_violation';
  END IF;
  -- The dishes and the amount are locked once the shop confirmed; the paid amount is recorded only on a confirmed, running Order.
  IF OLD.status <> 'PENDING_CONFIRMATION' AND (NEW.items_total_vnd <> OLD.items_total_vnd OR NEW.edited_at IS DISTINCT FROM OLD.edited_at) THEN
    RAISE EXCEPTION 'ORDER_ITEMS_LOCKED' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.paid_vnd <> OLD.paid_vnd AND NOT (OLD.status = 'PREPARING' AND NEW.status = 'PREPARING') THEN
    RAISE EXCEPTION 'ORDER_PAYMENT_NOT_ALLOWED' USING ERRCODE = 'restrict_violation';
  END IF;
  -- An Order is never confirmed empty.
  IF NEW.status = 'PREPARING' AND OLD.status = 'PENDING_CONFIRMATION' AND (
       NEW.items_total_vnd < 1 OR NOT EXISTS (SELECT 1 FROM app.order_items i WHERE i.order_id = NEW.order_id AND i.removed_at IS NULL)
     ) THEN
    RAISE EXCEPTION 'ORDER_EMPTY_CONFIRMATION' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER orders_guard BEFORE UPDATE ON app.orders FOR EACH ROW EXECUTE FUNCTION app.orders_guard();
CREATE TRIGGER orders_no_delete BEFORE DELETE OR TRUNCATE ON app.orders FOR EACH STATEMENT EXECUTE FUNCTION app.orders_guard();

CREATE FUNCTION app.order_items_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  parent_status varchar;
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'app.order_items is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT o.status INTO parent_status FROM app.orders o WHERE o.order_id = NEW.order_id;
  IF TG_OP = 'INSERT' THEN
    IF parent_status IS DISTINCT FROM 'PENDING_CONFIRMATION' OR NEW.removed_at IS NOT NULL
       OR NEW.unit_price_vnd <> NEW.orig_unit_price_vnd OR NEW.quantity <> NEW.orig_quantity THEN
      RAISE EXCEPTION 'ORDER_ITEMS_LOCKED' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.line_id <> OLD.line_id OR NEW.order_id <> OLD.order_id OR NEW.line_no <> OLD.line_no OR NEW.menu_item_id <> OLD.menu_item_id OR NEW.name <> OLD.name
     OR NEW.note IS DISTINCT FROM OLD.note OR NEW.orig_unit_price_vnd <> OLD.orig_unit_price_vnd OR NEW.orig_quantity <> OLD.orig_quantity OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'ORDER_ITEM_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF parent_status IS DISTINCT FROM 'PENDING_CONFIRMATION' THEN
    RAISE EXCEPTION 'ORDER_ITEMS_LOCKED' USING ERRCODE = 'restrict_violation';
  END IF;
  -- A removed line stays removed.
  IF OLD.removed_at IS NOT NULL AND (NEW.removed_at IS DISTINCT FROM OLD.removed_at OR NEW.quantity <> OLD.quantity OR NEW.unit_price_vnd <> OLD.unit_price_vnd) THEN
    RAISE EXCEPTION 'ORDER_ITEMS_LOCKED' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_items_guard BEFORE INSERT OR UPDATE ON app.order_items FOR EACH ROW EXECUTE FUNCTION app.order_items_guard();
CREATE TRIGGER order_items_no_delete BEFORE DELETE OR TRUNCATE ON app.order_items FOR EACH STATEMENT EXECUTE FUNCTION app.order_items_guard();

CREATE FUNCTION app.order_events_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.order_events is append-only (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER order_events_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON app.order_events FOR EACH STATEMENT EXECUTE FUNCTION app.order_events_reject_mutation();

-- Checked at COMMIT for every Order touched (directly, through a line, or through a delivery that carries it):
--  * the amounts equal the lines (original = every line as ordered; current = the lines not removed, at their edited price and quantity);
--  * an end Order other than COMPLETED has NO active delivery; a COMPLETED Order has a completed delivery; at most one delivery is active (also a unique index);
--  * a delivery exists only for a confirmed (PREPARING or later) Order of the same shop.
CREATE FUNCTION app.m10_assert_order(target_order uuid) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  o app.orders%ROWTYPE;
  original_sum bigint;
  current_sum bigint;
  active_deliveries integer;
  completed_deliveries integer;
  foreign_deliveries integer;
BEGIN
  SELECT * INTO o FROM app.orders WHERE order_id = target_order;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT COALESCE(sum(orig_unit_price_vnd * orig_quantity), 0), COALESCE(sum(unit_price_vnd * quantity) FILTER (WHERE removed_at IS NULL), 0)
    INTO original_sum, current_sum FROM app.order_items WHERE order_id = target_order;
  IF original_sum <> o.items_original_total_vnd OR current_sum <> o.items_total_vnd THEN
    RAISE EXCEPTION 'ORDER_INVARIANT_VIOLATION: the amounts do not equal the lines' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT count(*) FILTER (WHERE state IN ('waiting_driver', 'accepted', 'location_confirmed', 'picked_up', 'delivering')),
         count(*) FILTER (WHERE state = 'completed'),
         count(*) FILTER (WHERE shop_id <> o.shop_id)
    INTO active_deliveries, completed_deliveries, foreign_deliveries FROM app.deliveries WHERE order_id = target_order;
  IF foreign_deliveries > 0 OR (active_deliveries + completed_deliveries + foreign_deliveries > 0 AND o.status = 'PENDING_CONFIRMATION') THEN
    RAISE EXCEPTION 'ORDER_INVARIANT_VIOLATION: a delivery exists for an order that is not confirmed or belongs to another shop' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF o.status IN ('CANCELLED_BY_SHOP', 'NOT_COMPLETED', 'CANCELLED_BY_CUSTOMER', 'REJECTED_BY_SHOP') AND active_deliveries > 0 THEN
    RAISE EXCEPTION 'ORDER_INVARIANT_VIOLATION: an ended order still has an active delivery' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF o.status = 'COMPLETED' AND (completed_deliveries <> 1 OR active_deliveries > 0) THEN
    RAISE EXCEPTION 'ORDER_INVARIANT_VIOLATION: a completed order needs exactly one completed delivery' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END;
$$;
CREATE FUNCTION app.m10_order_invariants_trigger() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'deliveries' THEN
    IF NEW.order_id IS NOT NULL THEN
      PERFORM app.m10_assert_order(NEW.order_id);
    END IF;
  ELSE
    PERFORM app.m10_assert_order(NEW.order_id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER orders_invariants AFTER INSERT OR UPDATE ON app.orders
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.m10_order_invariants_trigger();
CREATE CONSTRAINT TRIGGER order_items_invariants AFTER INSERT OR UPDATE ON app.order_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.m10_order_invariants_trigger();
CREATE CONSTRAINT TRIGGER deliveries_order_invariants AFTER INSERT OR UPDATE ON app.deliveries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.m10_order_invariants_trigger();

-- ---------------------------------------------------------------------------------------------------
-- M07: a delivery's order_id now points at a real Order (asserted: none carried an id before M10)
-- ---------------------------------------------------------------------------------------------------
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM app.deliveries WHERE order_id IS NOT NULL) THEN
    RAISE EXCEPTION 'M10_MIGRATION_REFUSED: deliveries already carry an order id but no order table existed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$guard$;
ALTER TABLE app.deliveries ADD CONSTRAINT deliveries_order_fk FOREIGN KEY (order_id) REFERENCES app.orders (order_id) ON DELETE RESTRICT;

-- Down Migration
-- Only for disposable test or experimental databases. It refuses to run once an order, a line, an order event or a delivery of an order exists: that data is never
-- dropped (safety latch M10_DOWN_REFUSED). Carts are working data and go with their table. No CASCADE and no IF EXISTS.
DO $latch$
DECLARE
  rows_found bigint;
BEGIN
  SELECT (SELECT count(*) FROM app.orders) + (SELECT count(*) FROM app.order_items) + (SELECT count(*) FROM app.order_events)
       + (SELECT count(*) FROM app.deliveries WHERE order_id IS NOT NULL)
    INTO rows_found;
  IF rows_found > 0 THEN
    RAISE EXCEPTION 'M10_DOWN_REFUSED: % order row(s) exist; order history is never dropped', rows_found USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$latch$;
ALTER TABLE app.deliveries DROP CONSTRAINT deliveries_order_fk;
DROP TRIGGER deliveries_order_invariants ON app.deliveries;
DROP TRIGGER order_items_invariants ON app.order_items;
DROP TRIGGER orders_invariants ON app.orders;
DROP FUNCTION app.m10_order_invariants_trigger();
DROP FUNCTION app.m10_assert_order(uuid);
DROP TRIGGER order_events_append_only ON app.order_events;
DROP FUNCTION app.order_events_reject_mutation();
DROP TRIGGER order_items_no_delete ON app.order_items;
DROP TRIGGER order_items_guard ON app.order_items;
DROP FUNCTION app.order_items_guard();
DROP TRIGGER orders_no_delete ON app.orders;
DROP TRIGGER orders_guard ON app.orders;
DROP FUNCTION app.orders_guard();
DROP TABLE app.order_events;
DROP TABLE app.order_items;
DROP TABLE app.orders;
DROP TABLE app.customer_carts;
