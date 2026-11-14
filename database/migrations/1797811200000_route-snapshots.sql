-- Up Migration
-- P6-2 (#294): one immutable route snapshot for every priced or explicitly unpriced checkout quote. ADDITIVE only; no earlier migration is changed.
--  * app.route_snapshots: the M14 answer a quote was taken from (route_version, distance in whole metres, duration in seconds, the polyline6 geometry).
--    It holds no phone, no name and no customer address: only the route answer. It is append-only: UPDATE, DELETE and TRUNCATE are refused.
--  * app.orders.route_snapshot_id, app.deliveries.route_snapshot_id, app.address_change_requests.new_route_snapshot_id: nullable pointers.
--    Every Order, delivery and address-change request created before this migration keeps NULL. NOTHING is backfilled; no distance or fee changes.
--  * The pointer of an Order or a delivery moves only inside the same sessions that already move its distance and fee: the customer's own edit
--    (app.customer_order_edit = 'on') and an applied address change (app.address_change_in_progress = 'on'). Any other change is refused.
--    A snapshot row is never changed, so an old pointer always reproduces the geometry and distance that were shown when it was set.

CREATE TABLE app.route_snapshots (
  id uuid PRIMARY KEY,
  route_version text NOT NULL CHECK (route_version ~ '^[A-Za-z0-9][A-Za-z0-9._/+:-]{0,127}$'),
  distance_m integer NOT NULL CHECK (distance_m >= 0),
  duration_s integer NOT NULL CHECK (duration_s >= 0),
  geometry text NOT NULL CHECK (char_length(geometry) BETWEEN 1 AND 60000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION app.route_snapshots_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.route_snapshots is append-only (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER route_snapshots_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON app.route_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION app.route_snapshots_reject_mutation();

ALTER TABLE app.orders ADD COLUMN route_snapshot_id uuid REFERENCES app.route_snapshots(id);
ALTER TABLE app.deliveries ADD COLUMN route_snapshot_id uuid REFERENCES app.route_snapshots(id);
ALTER TABLE app.address_change_requests ADD COLUMN new_route_snapshot_id uuid REFERENCES app.route_snapshots(id);

CREATE FUNCTION app.route_snapshot_pointer_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.route_snapshot_id IS DISTINCT FROM OLD.route_snapshot_id
     AND COALESCE(current_setting('app.address_change_in_progress', true), '') <> 'on'
     AND COALESCE(current_setting('app.customer_order_edit', true), '') <> 'on' THEN
    RAISE EXCEPTION 'ROUTE_SNAPSHOT_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_route_snapshot_pointer_guard BEFORE UPDATE ON app.orders
  FOR EACH ROW EXECUTE FUNCTION app.route_snapshot_pointer_guard();
CREATE TRIGGER deliveries_route_snapshot_pointer_guard BEFORE UPDATE ON app.deliveries
  FOR EACH ROW EXECUTE FUNCTION app.route_snapshot_pointer_guard();

-- Down Migration
-- Only for disposable test or experimental databases. The snapshot rows and pointers go; Orders and deliveries keep their stored distance and fee.
DROP TRIGGER deliveries_route_snapshot_pointer_guard ON app.deliveries;
DROP TRIGGER orders_route_snapshot_pointer_guard ON app.orders;
DROP FUNCTION app.route_snapshot_pointer_guard();
ALTER TABLE app.address_change_requests DROP COLUMN new_route_snapshot_id;
ALTER TABLE app.deliveries DROP COLUMN route_snapshot_id;
ALTER TABLE app.orders DROP COLUMN route_snapshot_id;
DROP TRIGGER route_snapshots_append_only ON app.route_snapshots;
DROP FUNCTION app.route_snapshots_reject_mutation();
DROP TABLE app.route_snapshots;
