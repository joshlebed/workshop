-- Add GeoSports to the global games catalog. Migration 0023 seeded the
-- initial catalog; this extends it for the new entry without re-running
-- 0023 (which is already applied on prod). ON CONFLICT makes it idempotent
-- on a fresh DB that already got GeoSports from the updated 0023 seed.
INSERT INTO "games" ("normalized_url", "url", "title", "game_key", "score_direction") VALUES
	('geosports.app', 'https://www.geosports.app', 'GeoSports', 'geosports', 'desc')
ON CONFLICT ("normalized_url") DO NOTHING;
