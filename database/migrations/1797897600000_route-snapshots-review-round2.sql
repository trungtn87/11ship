-- Up Migration
-- P6-2 review round 2 (PR #346, Codex MEDIUM-1 and MEDIUM-2). A NEW migration: 1797811200000_route-snapshots is already reviewed and is not edited.
--  1. Content identity: app.route_snapshots.content_key (generated, sha256 of route_version | distance_m | duration_s | geometry) is UNIQUE. A quote that
--     repeats an identical route reuses the existing row (INSERT ... ON CONFLICT DO NOTHING) instead of storing another copy. Rows are still never UPDATEd.
--  2. Retention (D6-3, narrow): app.purge_unreferenced_route_snapshots(older_than) is the ONLY way a snapshot row is deleted. It removes rows that no
--     Order, delivery or address-change request points to and that are older than the given interval. The append-only trigger allows DELETE only while the
--     function sets app.route_snapshot_purge = 'on' for its own transaction; UPDATE and TRUNCATE stay refused; a hand DELETE stays refused. A row trigger
--     refuses any row that is still referenced, and a foreign key is the last line (a referenced row cannot be deleted at all).
--  4. Pointer guard order (review round 3): the pointer change is checked FIRST, before any early return. A non-NULL pointer that changes is refused outside an
--     approved session (app.address_change_in_progress or app.customer_order_edit) with ROUTE_SNAPSHOT_IMMUTABLE. Inside a session, a non-NULL pointer may
--     move to another non-NULL snapshot (pair checked below) or be cleared to NULL ONLY when the distance is cleared in the same statement: that is the
--     existing text-only address change and the edit to an unpinned address (both clear the distance too). A pointer cleared while its distance remains is refused.
--  5. PRECONDITION (review round 3): the backfill of content_key and the UNIQUE index assume no two existing rows have identical content. A database that already
--     ran the round-1 snapshot migration WITH data must remove duplicate content first (keep one row, repoint references); otherwise this migration fails
--     with 23505 and rolls back. No such data exists where this migration has not been applied.
--  3. Pair guard: when an Order or delivery points to a snapshot, its distance column must equal app.route_snapshots.distance_m of that snapshot. This is
--     checked on INSERT and on UPDATE of the pointer or of the distance, also inside the customer-edit and address-change sessions. A pointer-only,
--     distance-only or mismatched pair is refused with ROUTE_SNAPSHOT_MISMATCH (pointer changes outside an approved session keep ROUTE_SNAPSHOT_IMMUTABLE).

-- 1. content identity: a BEFORE INSERT trigger sets content_key (sha256 of the content). The DEFAULT only fills rows that already exist, without an UPDATE
--    (the append-only trigger refuses UPDATE). A generated column is not used: its expression must be immutable, and convert_to is not.
-- Backfill of rows that already exist: a one-time migration step, the only UPDATE of this table. The append-only trigger is disabled for this statement only
-- (the table is not deployed anywhere yet; a database with snapshot rows keeps every row, only its new hash column is filled).
ALTER TABLE app.route_snapshots ADD COLUMN content_key text;
ALTER TABLE app.route_snapshots DISABLE TRIGGER route_snapshots_append_only;
UPDATE app.route_snapshots SET content_key = encode(sha256(convert_to(route_version || '|' || distance_m::text || '|' || duration_s::text || '|' || geometry, 'UTF8')), 'hex');
ALTER TABLE app.route_snapshots ENABLE TRIGGER route_snapshots_append_only;
ALTER TABLE app.route_snapshots ALTER COLUMN content_key SET NOT NULL;
CREATE UNIQUE INDEX route_snapshots_content_key_uidx ON app.route_snapshots (content_key);
CREATE FUNCTION app.route_snapshots_set_content_key() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.content_key := encode(sha256(convert_to(NEW.route_version || '|' || NEW.distance_m::text || '|' || NEW.duration_s::text || '|' || NEW.geometry, 'UTF8')), 'hex');
  RETURN NEW;
END;
$$;
CREATE TRIGGER route_snapshots_content_key BEFORE INSERT ON app.route_snapshots FOR EACH ROW EXECUTE FUNCTION app.route_snapshots_set_content_key();

-- 2. append-only trigger: DELETE only inside the purge function; UPDATE and TRUNCATE refused as before
CREATE OR REPLACE FUNCTION app.route_snapshots_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND COALESCE(current_setting('app.route_snapshot_purge', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'app.route_snapshots is append-only (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE FUNCTION app.route_snapshots_purge_row_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.orders o WHERE o.route_snapshot_id = OLD.id)
     OR EXISTS (SELECT 1 FROM app.deliveries d WHERE d.route_snapshot_id = OLD.id)
     OR EXISTS (SELECT 1 FROM app.address_change_requests a WHERE a.new_route_snapshot_id = OLD.id) THEN
    RAISE EXCEPTION 'ROUTE_SNAPSHOT_REFERENCED' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER route_snapshots_purge_row_guard BEFORE DELETE ON app.route_snapshots
  FOR EACH ROW EXECUTE FUNCTION app.route_snapshots_purge_row_guard();

-- The only deleter. SECURITY DEFINER (owned by the migration role); the runtime role gets EXECUTE only (03-runtime-function-grants.sql).
CREATE FUNCTION app.purge_unreferenced_route_snapshots(p_older_than interval) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  removed integer;
BEGIN
  -- Fixed floor at the SECURITY DEFINER boundary: the runtime role cannot remove a fresh quote's snapshot by passing a short interval.
  IF p_older_than IS NULL OR p_older_than < interval '7 days' THEN
    RAISE EXCEPTION 'ROUTE_SNAPSHOT_RETENTION_TOO_SHORT' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM set_config('app.route_snapshot_purge', 'on', true);
  WITH victims AS (
    SELECT r.id FROM app.route_snapshots r
     WHERE r.created_at < clock_timestamp() - p_older_than
       AND NOT EXISTS (SELECT 1 FROM app.orders o WHERE o.route_snapshot_id = r.id)
       AND NOT EXISTS (SELECT 1 FROM app.deliveries d WHERE d.route_snapshot_id = r.id)
       AND NOT EXISTS (SELECT 1 FROM app.address_change_requests a WHERE a.new_route_snapshot_id = r.id)
     ORDER BY r.created_at, r.id
     LIMIT 200
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM app.route_snapshots s USING victims v WHERE s.id = v.id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  PERFORM set_config('app.route_snapshot_purge', 'off', true);
  RETURN removed;
END;
$$;
REVOKE EXECUTE ON FUNCTION app.purge_unreferenced_route_snapshots(interval) FROM PUBLIC;

-- 3. pair guard for Orders and deliveries (replaces the pointer-only guard of the previous migration)
DROP TRIGGER orders_route_snapshot_pointer_guard ON app.orders;
DROP TRIGGER deliveries_route_snapshot_pointer_guard ON app.deliveries;
DROP FUNCTION app.route_snapshot_pointer_guard();

CREATE FUNCTION app.orders_route_snapshot_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  snap_distance integer;
  session_ok boolean := COALESCE(current_setting('app.address_change_in_progress', true), '') = 'on'
                     OR COALESCE(current_setting('app.customer_order_edit', true), '') = 'on';
BEGIN
  -- 1. the pointer itself: checked before anything else, so no early return can skip it
  IF TG_OP = 'UPDATE' AND NEW.route_snapshot_id IS DISTINCT FROM OLD.route_snapshot_id THEN
    IF NOT session_ok THEN
      RAISE EXCEPTION 'ROUTE_SNAPSHOT_IMMUTABLE' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.route_snapshot_id IS NULL AND NEW.fee_estimate_distance_m IS NOT NULL THEN
      RAISE EXCEPTION 'ROUTE_SNAPSHOT_IMMUTABLE' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  -- 2. no pointer (before this change, or cleared together with its distance): nothing to pair
  IF NEW.route_snapshot_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- 3. the pair: an unchanged pointer with an unchanged distance is not re-checked
  IF TG_OP = 'UPDATE' AND NEW.route_snapshot_id IS NOT DISTINCT FROM OLD.route_snapshot_id AND NEW.fee_estimate_distance_m IS NOT DISTINCT FROM OLD.fee_estimate_distance_m THEN
    RETURN NEW;
  END IF;
  SELECT r.distance_m INTO snap_distance FROM app.route_snapshots r WHERE r.id = NEW.route_snapshot_id;
  IF snap_distance IS NULL OR NEW.fee_estimate_distance_m IS DISTINCT FROM snap_distance THEN
    RAISE EXCEPTION 'ROUTE_SNAPSHOT_MISMATCH' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION app.deliveries_route_snapshot_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  snap_distance integer;
  session_ok boolean := COALESCE(current_setting('app.address_change_in_progress', true), '') = 'on';
BEGIN
  -- 1. the pointer itself: checked before anything else, so no early return can skip it
  IF TG_OP = 'UPDATE' AND NEW.route_snapshot_id IS DISTINCT FROM OLD.route_snapshot_id THEN
    IF NOT session_ok THEN
      RAISE EXCEPTION 'ROUTE_SNAPSHOT_IMMUTABLE' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.route_snapshot_id IS NULL AND NEW.route_distance_m IS NOT NULL THEN
      RAISE EXCEPTION 'ROUTE_SNAPSHOT_IMMUTABLE' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  -- 2. no pointer: nothing to pair
  IF NEW.route_snapshot_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- 3. the pair: an unchanged pointer with an unchanged distance is not re-checked
  IF TG_OP = 'UPDATE' AND NEW.route_snapshot_id IS NOT DISTINCT FROM OLD.route_snapshot_id AND NEW.route_distance_m IS NOT DISTINCT FROM OLD.route_distance_m THEN
    RETURN NEW;
  END IF;
  SELECT r.distance_m INTO snap_distance FROM app.route_snapshots r WHERE r.id = NEW.route_snapshot_id;
  IF snap_distance IS NULL OR NEW.route_distance_m IS DISTINCT FROM snap_distance THEN
    RAISE EXCEPTION 'ROUTE_SNAPSHOT_MISMATCH' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_route_snapshot_pointer_guard BEFORE INSERT OR UPDATE ON app.orders
  FOR EACH ROW EXECUTE FUNCTION app.orders_route_snapshot_guard();
CREATE TRIGGER deliveries_route_snapshot_pointer_guard BEFORE INSERT OR UPDATE ON app.deliveries
  FOR EACH ROW EXECUTE FUNCTION app.deliveries_route_snapshot_guard();

-- Down Migration
-- Only for disposable test or experimental databases.
DROP TRIGGER deliveries_route_snapshot_pointer_guard ON app.deliveries;
DROP TRIGGER orders_route_snapshot_pointer_guard ON app.orders;
DROP FUNCTION app.deliveries_route_snapshot_guard();
DROP FUNCTION app.orders_route_snapshot_guard();
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
CREATE TRIGGER orders_route_snapshot_pointer_guard BEFORE UPDATE ON app.orders FOR EACH ROW EXECUTE FUNCTION app.route_snapshot_pointer_guard();
CREATE TRIGGER deliveries_route_snapshot_pointer_guard BEFORE UPDATE ON app.deliveries FOR EACH ROW EXECUTE FUNCTION app.route_snapshot_pointer_guard();
REVOKE EXECUTE ON FUNCTION app.purge_unreferenced_route_snapshots(interval) FROM PUBLIC;
DROP FUNCTION app.purge_unreferenced_route_snapshots(interval);
DROP TRIGGER route_snapshots_purge_row_guard ON app.route_snapshots;
DROP FUNCTION app.route_snapshots_purge_row_guard();
CREATE OR REPLACE FUNCTION app.route_snapshots_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.route_snapshots is append-only (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
DROP TRIGGER route_snapshots_content_key ON app.route_snapshots;
DROP FUNCTION app.route_snapshots_set_content_key();
DROP INDEX app.route_snapshots_content_key_uidx;
ALTER TABLE app.route_snapshots DROP COLUMN content_key;
