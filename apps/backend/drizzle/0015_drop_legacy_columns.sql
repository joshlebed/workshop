-- Drop the legacy columns kept as nullable dead weight in 0014 (the list
-- data model redesign). Reads/writes have been on the new shape
-- (`lists.modules`, `lists.item_kind`, `items.kind`, `items.content`,
-- `items.position`) since 0014 shipped. `game_scores` was likewise mirrored
-- into `item_scores` in 0014 — this migration drops the legacy table.
--
-- Also: adds the per-kind dedup partial unique index for `movie` items,
-- enabling the Letterboxd source kind to lean on `(list_id, tmdbId)`
-- uniqueness the same way Spotify leans on `(list_id, spotifyAlbumId)`.

ALTER TABLE "game_scores" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "game_scores" CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "items_list_movie_tmdb_id_idx" ON "items" USING btree ("list_id",("content"->>'tmdbId')) WHERE kind = 'movie' AND content ? 'tmdbId';--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "metadata";--> statement-breakpoint
ALTER TABLE "lists" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "lists" DROP COLUMN "metadata";--> statement-breakpoint
DROP TYPE "public"."list_type";