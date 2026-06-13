CREATE TABLE "game_spec_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"taught_by" uuid,
	"score_spec" jsonb NOT NULL,
	"score_direction" text NOT NULL,
	"summary_spec" jsonb,
	"example_raw" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_spec_revisions" ADD CONSTRAINT "game_spec_revisions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_spec_revisions" ADD CONSTRAINT "game_spec_revisions_taught_by_users_id_fk" FOREIGN KEY ("taught_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_spec_revisions_game_created_idx" ON "game_spec_revisions" USING btree ("game_id","created_at");