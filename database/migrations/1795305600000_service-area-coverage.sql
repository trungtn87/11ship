-- Up Migration
-- No guessed/default geometry: existing areas and shop membership remain intact.
-- Configure all three values explicitly before enabling GPS coverage for an area.
ALTER TABLE app.service_areas
  ADD COLUMN coverage_lat double precision,
  ADD COLUMN coverage_lng double precision,
  ADD COLUMN coverage_radius_m integer,
  ADD CONSTRAINT service_area_coverage_valid CHECK (
    (coverage_lat IS NULL AND coverage_lng IS NULL AND coverage_radius_m IS NULL)
    OR (coverage_lat IS NOT NULL AND coverage_lng IS NOT NULL AND coverage_radius_m IS NOT NULL
      AND coverage_lat BETWEEN -90 AND 90 AND coverage_lng BETWEEN -180 AND 180
      AND coverage_radius_m BETWEEN 1 AND 100000)
  );

-- Down Migration
ALTER TABLE app.service_areas DROP CONSTRAINT service_area_coverage_valid,
  DROP COLUMN coverage_radius_m, DROP COLUMN coverage_lng, DROP COLUMN coverage_lat;
