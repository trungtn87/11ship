-- Up Migration
-- #207: nullable, additive; existing items and historical order snapshots are untouched.
-- Grapheme limit is checked by the API (Intl.Segmenter), not PostgreSQL codepoint length.
ALTER TABLE app.menu_items ADD COLUMN description text;

-- Down Migration
ALTER TABLE app.menu_items DROP COLUMN description;
