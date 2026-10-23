-- Up Migration
-- Optional logo, saved atomically with the versioned shop profile. Existing clients omit the field and preserve it.
ALTER TABLE app.shops ADD COLUMN logo jsonb;
ALTER TABLE app.shops ADD CONSTRAINT shops_logo_shape CHECK (
  logo IS NULL OR (jsonb_typeof(logo) = 'object'
    AND logo ? 'content_type' AND logo ? 'data_base64'
    AND logo->>'content_type' IN ('image/png', 'image/jpeg', 'image/webp')
    AND jsonb_typeof(logo->'data_base64') = 'string'
    AND length(logo->>'data_base64') BETWEEN 1 AND 1398104)
);

-- Down Migration
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM app.shops WHERE logo IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove shop logos while stored logos exist';
  END IF;
END $$;
ALTER TABLE app.shops DROP COLUMN logo;
