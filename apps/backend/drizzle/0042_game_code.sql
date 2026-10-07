CREATE TABLE "game_code_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"parse_code" text,
	"format_code" text,
	"source" text NOT NULL,
	"authored_by" uuid,
	"note" text,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_scores" ADD COLUMN "parse_status" text;--> statement-breakpoint
ALTER TABLE "game_scores" ADD COLUMN "score_summary" text;--> statement-breakpoint
ALTER TABLE "game_scores" ADD COLUMN "code_version" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "parse_code" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "format_code" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "code_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "game_code_revisions" ADD CONSTRAINT "game_code_revisions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_code_revisions" ADD CONSTRAINT "game_code_revisions_authored_by_users_id_fk" FOREIGN KEY ("authored_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_code_revisions_game_version_idx" ON "game_code_revisions" USING btree ("game_id","version");--> statement-breakpoint
ALTER TABLE "game_scores" ADD CONSTRAINT "game_scores_parse_status_check" CHECK ("game_scores"."parse_status" IN ('score', 'no_result', 'failed'));