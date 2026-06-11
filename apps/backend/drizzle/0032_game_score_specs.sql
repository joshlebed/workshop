ALTER TABLE "games" ADD COLUMN "score_spec" jsonb;
--> statement-breakpoint
-- Seed the registry games added in this change (Connections, Strands, NYT
-- Mini, Spelling Bee). ON CONFLICT DO UPDATE (not DO NOTHING) deliberately:
-- a game can already exist as an *unknown* row (game_key NULL) when someone
-- added it by URL before the registry knew it — prod has exactly this for
-- nytimes.com/crosswords/game/mini ("Play The Mini Crosswords") and
-- geosports.app (the 0031 DO NOTHING seed silently lost to a pre-existing
-- row). Claiming the row sets game_key/title/direction so registry parsing
-- kicks in; icon_url is left alone (existing favicons are fine). The WHERE
-- guard makes this idempotent and refuses to clobber a row already claimed
-- by a different key.
INSERT INTO "games" ("normalized_url", "url", "title", "game_key", "score_direction") VALUES
	('nytimes.com/games/connections', 'https://www.nytimes.com/games/connections', 'Connections', 'connections', 'asc'),
	('nytimes.com/games/strands', 'https://www.nytimes.com/games/strands', 'Strands', 'strands', 'asc'),
	('nytimes.com/crosswords/game/mini', 'https://www.nytimes.com/crosswords/game/mini', 'NYT Mini', 'nyt-mini', 'asc'),
	('nytimes.com/puzzles/spelling-bee', 'https://www.nytimes.com/puzzles/spelling-bee', 'Spelling Bee', 'spelling-bee', 'desc')
ON CONFLICT ("normalized_url") DO UPDATE SET
	"game_key" = excluded."game_key",
	"title" = excluded."title",
	"url" = excluded."url",
	"score_direction" = excluded."score_direction"
WHERE "games"."game_key" IS NULL OR "games"."game_key" = excluded."game_key";
--> statement-breakpoint
-- Claim the pre-existing GeoSports row if 0031's DO NOTHING lost the race to
-- a find-or-create row (prod: game_key NULL, preview-derived title).
UPDATE "games" SET "game_key" = 'geosports', "title" = 'GeoSports', "score_direction" = 'desc'
	WHERE "normalized_url" = 'geosports.app' AND "game_key" IS NULL;
--> statement-breakpoint
-- Framed is scored by guess position now (position of 🟩), which is
-- lower-is-better — the old regex graded everyone by the shared puzzle
-- number, direction desc. Re-run scripts/rescore-game.ts --game-key=framed
-- after deploy to fix any historical values.
UPDATE "games" SET "score_direction" = 'asc' WHERE "game_key" = 'framed';
--> statement-breakpoint
UPDATE "items" SET "score_direction" = 'asc'
	WHERE "game_id" IN (SELECT "id" FROM "games" WHERE "game_key" = 'framed');
--> statement-breakpoint
-- New seed rows need the same favicon fallback 0028 gave earlier rows.
UPDATE "games"
SET "icon_url" = 'https://www.google.com/s2/favicons?domain='
  || split_part(split_part("normalized_url", '/', 1), ':', 1)
  || '&sz=128'
WHERE "icon_url" IS NULL;
