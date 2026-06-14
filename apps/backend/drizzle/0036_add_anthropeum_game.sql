-- Add Anthropeum to the global games catalog. A pre-existing *unknown* row
-- (game_key NULL) already exists in prod — someone pasted an Anthropeum score
-- before the registry knew the game, so find-or-create made the row and the
-- teach flow stored a user-taught score_spec on it. ON CONFLICT DO UPDATE (not
-- DO NOTHING) claims that row: setting game_key/title/url/direction makes
-- registry parsing + the formatShareBody recap kick in (the stale user-taught
-- score_spec is then ignored — registry games keep their spec in code). The
-- WHERE guard makes it idempotent and refuses to clobber a row already claimed
-- by a different key. icon_url is left alone (the existing favicon is fine; the
-- trailing backfill covers a fresh insert on a test/dev DB).
INSERT INTO "games" ("normalized_url", "url", "title", "game_key", "score_direction") VALUES
	('anthropeum.com', 'https://anthropeum.com', 'Anthropeum', 'anthropeum', 'desc')
ON CONFLICT ("normalized_url") DO UPDATE SET
	"game_key" = excluded."game_key",
	"title" = excluded."title",
	"url" = excluded."url",
	"score_direction" = excluded."score_direction"
WHERE "games"."game_key" IS NULL OR "games"."game_key" = excluded."game_key";
--> statement-breakpoint
-- A fresh insert (test/dev DB) needs the same s2 favicon fallback 0028 gave
-- earlier rows; 0028 only backfilled rows that existed at the time.
UPDATE "games"
SET "icon_url" = 'https://www.google.com/s2/favicons?domain='
  || split_part(split_part("normalized_url", '/', 1), ':', 1)
  || '&sz=128'
WHERE "icon_url" IS NULL;
