CREATE TABLE "game_scores" (
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"score_value" numeric,
	"score_raw" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_scores_game_id_user_id_period_key_pk" PRIMARY KEY("game_id","user_id","period_key")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized_url" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"icon_url" text,
	"game_key" text,
	"score_direction" text DEFAULT 'desc' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_normalized_url_unique" UNIQUE("normalized_url")
);
--> statement-breakpoint
CREATE TABLE "user_games" (
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"position" integer,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_games_user_id_game_id_pk" PRIMARY KEY("user_id","game_id")
);
--> statement-breakpoint
ALTER TABLE "game_scores" ADD CONSTRAINT "game_scores_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_scores" ADD CONSTRAINT "game_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_games" ADD CONSTRAINT "user_games_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_games" ADD CONSTRAINT "user_games_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_scores_game_period_idx" ON "game_scores" USING btree ("game_id","period_key");--> statement-breakpoint
CREATE INDEX "user_games_user_position_idx" ON "user_games" USING btree ("user_id","position");--> statement-breakpoint
-- Seed the global catalog from the gameScoreRegex catalog (spec §3.3).
-- normalized_url = normalizeGameUrl(canonicalUrl); a vitest
-- (routes/v1/games.test.ts) asserts this stays in sync with
-- src/lib/gameScoreRegex.ts. ON CONFLICT keeps the seed idempotent.
INSERT INTO "games" ("normalized_url", "url", "title", "game_key", "score_direction") VALUES
	('maptap.gg', 'https://maptap.gg', 'MapTap', 'maptap', 'desc'),
	('globle-game.com', 'https://globle-game.com', 'Globle', 'globle', 'asc'),
	('satle.ca', 'https://satle.ca', 'Satle', 'satle', 'asc'),
	('travle.earth', 'https://travle.earth', 'Travle', 'travle', 'asc'),
	('nytimes.com/games/wordle', 'https://www.nytimes.com/games/wordle', 'Wordle', 'wordle', 'asc'),
	('worldle.teuteuf.fr', 'https://worldle.teuteuf.fr', 'Worldle', 'worldle', 'asc'),
	('tradle.net', 'https://tradle.net', 'Tradle', 'tradle', 'asc'),
	('framed.wtf', 'https://framed.wtf', 'Framed', 'framed', 'desc'),
	('dailytens.com', 'https://dailytens.com', 'Daily Tens', 'dailytens', 'desc'),
	('geosports.app', 'https://www.geosports.app', 'GeoSports', 'geosports', 'desc')
ON CONFLICT ("normalized_url") DO NOTHING;
