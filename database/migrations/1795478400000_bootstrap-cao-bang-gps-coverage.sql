-- Up Migration
-- Owner decision 2026-10-22: bootstrap the existing Cao Bằng ACTIVE delivery area
-- to a 10 km radius around the published city-centre reference point.
-- Coordinates: 22.66667 N, 106.25833 E (WGS84); circle is operational coverage,
-- not an administrative boundary or a road-distance threshold.
-- This migration is additive: never create an area, never touch other regions,
-- and never overwrite an operator-configured coverage.
DO $coverage$
DECLARE
  matching_areas integer;
BEGIN
  SELECT count(*) INTO matching_areas
    FROM app.service_areas
   WHERE name = 'Cao Bằng' AND status = 'ACTIVE';

  IF matching_areas > 1 THEN
    RAISE EXCEPTION 'Cao Bang GPS coverage: multiple ACTIVE areas with the same name; operator must choose an ID';
  END IF;

  UPDATE app.service_areas
     SET coverage_lat = 22.66667,
         coverage_lng = 106.25833,
         coverage_radius_m = 10000,
         updated_at = clock_timestamp(),
         version = version + 1
   WHERE name = 'Cao Bằng'
     AND status = 'ACTIVE'
     AND coverage_lat IS NULL
     AND coverage_lng IS NULL
     AND coverage_radius_m IS NULL;
END
$coverage$;

-- Down Migration
-- Test/experimental rollback only. Restrict to the exact initial values.
-- Never remove a subsequently changed or separately configured zone.
UPDATE app.service_areas
   SET coverage_lat = NULL,
       coverage_lng = NULL,
       coverage_radius_m = NULL,
       updated_at = clock_timestamp(),
       version = version + 1
 WHERE name = 'Cao Bằng'
   AND status = 'ACTIVE'
   AND coverage_lat = 22.66667
   AND coverage_lng = 106.25833
   AND coverage_radius_m = 10000;
