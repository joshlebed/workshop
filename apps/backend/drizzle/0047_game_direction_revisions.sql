CREATE TABLE "game_direction_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"from_direction" text NOT NULL,
	"to_direction" text NOT NULL,
	"authored_by" uuid,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_direction_revisions" ADD CONSTRAINT "game_direction_revisions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_direction_revisions" ADD CONSTRAINT "game_direction_revisions_authored_by_users_id_fk" FOREIGN KEY ("authored_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_direction_revisions_game_created_idx" ON "game_direction_revisions" USING btree ("game_id","created_at");--> statement-breakpoint
-- Record the one direction change made by hand before this table existed:
-- GeoHistory asc → desc on 2026-10-08 (its taught "lower is better" was the
-- old teach sheet's default for an N/M score, not a choice). Matches nothing
-- on a database without that game, or where it has since changed again.
INSERT INTO "game_direction_revisions" ("game_id", "from_direction", "to_direction", "authored_by", "note", "created_at")
SELECT g."id", 'asc', 'desc',
       (SELECT u."id" FROM "users" u WHERE u."email" = 'joshlebed@gmail.com'),
       'Recorded after the fact: set by hand on 2026-10-08. A higher GeoHistory score (N / 1,000) is better; asc was the teach sheet''s default for an N/M score, never chosen.',
       '2026-10-08T01:35:46.911Z'
FROM "games" g
WHERE g."normalized_url" = 'geohistory.gg' AND g."score_direction" = 'desc';
