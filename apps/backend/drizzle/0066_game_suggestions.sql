CREATE TABLE "game_suggestion_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"event" text NOT NULL,
	"surface" text NOT NULL,
	"reason_kind" text NOT NULL,
	"rank" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client" text,
	"platform" text,
	"app_version" text
);
--> statement-breakpoint
ALTER TABLE "game_suggestion_events" ADD CONSTRAINT "game_suggestion_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_suggestion_events" ADD CONSTRAINT "game_suggestion_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_suggestion_events_user_idx" ON "game_suggestion_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_games_game_user_idx" ON "user_games" USING btree ("game_id","user_id");