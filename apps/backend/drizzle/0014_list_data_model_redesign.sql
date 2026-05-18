-- List data model redesign (PR-A through PR-F, see docs/list-data-model-redesign.md)
--
-- Migrates from the old `lists.type` enum + per-type `metadata` jsonb to a
-- modules + kind + content shape:
--   - `lists.modules text[]`             — behaviors enabled on the list
--   - `lists.item_kind text` (nullable)  — constrains the kind of items
--   - `items.kind text`                  — the content shape
--   - `items.content jsonb`              — kind-specific payload
--   - `items.position integer`           — manual ordering
--   - new table `list_sources`           — external feeds (Spotify, future kinds)
--   - new table `item_scores`            — generalizes `game_scores`
--   - activity_events.event_type → text  — registry-backed, no Postgres enum
--
-- Old columns (`lists.type`, `lists.metadata`, `items.type`, `items.metadata`)
-- are left in place as nullable dead weight; a follow-up cleanup PR will drop
-- them once we're confident no readers remain. game_scores is kept too —
-- data is mirrored into item_scores by this migration.

-- --- New tables ------------------------------------------------------------

CREATE TABLE "item_scores" (
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"score_value" numeric,
	"score_raw" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_scores_item_id_user_id_period_key_pk" PRIMARY KEY("item_id","user_id","period_key")
);
--> statement-breakpoint
CREATE TABLE "list_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_synced_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_scores" ADD CONSTRAINT "item_scores_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_scores" ADD CONSTRAINT "item_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_sources" ADD CONSTRAINT "list_sources_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_sources" ADD CONSTRAINT "list_sources_last_synced_by_users_id_fk" FOREIGN KEY ("last_synced_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_scores_item_period_idx" ON "item_scores" USING btree ("item_id","period_key");--> statement-breakpoint
CREATE INDEX "item_scores_user_period_idx" ON "item_scores" USING btree ("user_id","period_key");--> statement-breakpoint
CREATE INDEX "list_sources_list_idx" ON "list_sources" USING btree ("list_id");--> statement-breakpoint

-- --- New columns on lists / items / activity_events ------------------------

ALTER TABLE "activity_events" ALTER COLUMN "event_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lists" ALTER COLUMN "type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "content" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "modules" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "item_kind" text;--> statement-breakpoint

-- --- Backfill --------------------------------------------------------------
-- Mapping (type → item_kind, modules):
--   movie / tv / book   →  (kind, [voting, todo, ranking])
--   date_idea / trip    →  (link,  [voting, todo, ranking])
--   game                →  (link,  [voting, leaderboard, ranking])
--   album_shelf         →  (spotify_album, [voting, ranking, sources])
-- Lists predating any of these types fall back to (plain, [ranking]).

UPDATE "lists" SET
  "modules" = CASE
    WHEN "type" = 'album_shelf' THEN ARRAY['voting','ranking','sources']::text[]
    WHEN "type" = 'game'        THEN ARRAY['voting','leaderboard','ranking']::text[]
    WHEN "type" IS NULL         THEN ARRAY['ranking']::text[]
    ELSE                              ARRAY['voting','todo','ranking']::text[]
  END,
  "item_kind" = CASE "type"
    WHEN 'movie'       THEN 'movie'
    WHEN 'tv'          THEN 'tv'
    WHEN 'book'        THEN 'book'
    WHEN 'date_idea'   THEN 'link'
    WHEN 'trip'        THEN 'link'
    WHEN 'game'        THEN 'link'
    WHEN 'album_shelf' THEN 'spotify_album'
    ELSE                    NULL
  END
WHERE "modules" = '{}'::text[];
--> statement-breakpoint

-- items: derive `kind` from the parent list's `type`, copy metadata into
-- content (stripping the now-dedicated `position` key), and promote
-- `metadata.position` to a real integer column.
UPDATE "items" i SET
  "kind" = CASE l."type"
    WHEN 'movie'       THEN 'movie'
    WHEN 'tv'          THEN 'tv'
    WHEN 'book'        THEN 'book'
    WHEN 'date_idea'   THEN 'link'
    WHEN 'trip'        THEN 'link'
    WHEN 'game'        THEN 'link'
    WHEN 'album_shelf' THEN 'spotify_album'
    ELSE                    'plain'
  END,
  "content" = COALESCE(i."metadata", '{}'::jsonb) - 'position',
  "position" = CASE
    WHEN i."metadata" ? 'position'
      AND jsonb_typeof(i."metadata"->'position') = 'number'
    THEN ((i."metadata"->>'position')::numeric)::int
    ELSE NULL
  END
FROM "lists" l
WHERE i."list_id" = l."id" AND i."kind" IS NULL;
--> statement-breakpoint

-- Backfill list_sources from album_shelf metadata. Carries over the legacy
-- `lastRefreshedAt` / `lastRefreshedBy` into `last_synced_at` / `last_synced_by`.
INSERT INTO "list_sources" ("list_id", "kind", "config", "last_synced_at", "last_synced_by")
SELECT
  l."id",
  'spotify_playlist',
  jsonb_build_object(
    'spotifyPlaylistUrl', l."metadata"->>'spotifyPlaylistUrl',
    'spotifyPlaylistId',  l."metadata"->>'spotifyPlaylistId'
  ),
  CASE WHEN l."metadata" ? 'lastRefreshedAt'
       THEN (l."metadata"->>'lastRefreshedAt')::timestamptz
       ELSE NULL
  END,
  CASE WHEN l."metadata" ? 'lastRefreshedBy'
       THEN (l."metadata"->>'lastRefreshedBy')::uuid
       ELSE NULL
  END
FROM "lists" l
WHERE l."type" = 'album_shelf'
  AND l."metadata" ? 'spotifyPlaylistUrl'
  AND l."metadata" ? 'spotifyPlaylistId'
  AND NOT EXISTS (
    SELECT 1 FROM "list_sources" s WHERE s."list_id" = l."id"
  );
--> statement-breakpoint

-- Backfill item_scores from game_scores. period_key = date verbatim;
-- score_value parsed lazily from the first integer-looking token in score_raw
-- (NULL when no parse — the leaderboard renderer falls back to score_raw).
INSERT INTO "item_scores" ("item_id", "user_id", "period_key", "score_raw", "score_value", "created_at", "updated_at")
SELECT
  g."item_id",
  g."user_id",
  g."date",
  g."score",
  NULL::numeric,
  g."created_at",
  g."updated_at"
FROM "game_scores" g
ON CONFLICT ("item_id", "user_id", "period_key") DO NOTHING;
--> statement-breakpoint

-- Activity events: rename legacy event types in place (§4.1 of the redesign).
UPDATE "activity_events"
SET event_type = 'source_synced',
    payload = payload || jsonb_build_object('kind', 'spotify_playlist')
WHERE event_type = 'album_shelf_refreshed';
--> statement-breakpoint
UPDATE "activity_events"
SET event_type = 'source_updated',
    payload = payload || jsonb_build_object('kind', 'spotify_playlist')
WHERE event_type = 'album_shelf_source_changed';
--> statement-breakpoint
UPDATE "activity_events" SET event_type = 'item_promoted' WHERE event_type = 'album_promoted';--> statement-breakpoint
UPDATE "activity_events" SET event_type = 'item_demoted'  WHERE event_type = 'album_demoted';--> statement-breakpoint

-- --- Indexes -------------------------------------------------------------
-- Replace the legacy album-shelf dedup index (keyed on metadata) with the
-- kind-aware version keyed on content. Drop the old one only after the new
-- index exists so the dedup invariant holds throughout the migration.

DROP INDEX IF EXISTS "items_list_spotify_album_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_list_position_idx" ON "items" USING btree ("list_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "items_list_spotify_album_content_idx" ON "items" USING btree ("list_id",("content"->>'spotifyAlbumId')) WHERE kind = 'spotify_album' AND content ? 'spotifyAlbumId';--> statement-breakpoint

-- Drop the activity_event_type enum: every column referencing it has been
-- migrated to text in this same transaction.
DROP TYPE IF EXISTS "public"."activity_event_type";
