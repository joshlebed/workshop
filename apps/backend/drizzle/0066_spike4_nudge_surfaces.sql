CREATE TABLE "auto_nudges" (
	"user_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"game_id" uuid NOT NULL,
	"friend_ids" uuid[] NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_nudges_user_id_period_key_pk" PRIMARY KEY("user_id","period_key")
);
--> statement-breakpoint
ALTER TABLE "game_nudges" ADD COLUMN "surface" text DEFAULT 'board' NOT NULL;--> statement-breakpoint
ALTER TABLE "game_nudges" ADD COLUMN "answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auto_nudges" ADD CONSTRAINT "auto_nudges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_nudges" ADD CONSTRAINT "auto_nudges_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auto_nudges_sent_at_idx" ON "auto_nudges" USING btree ("sent_at");--> statement-breakpoint
ALTER TABLE "game_nudges" ADD CONSTRAINT "game_nudges_surface_check" CHECK ("game_nudges"."surface" IN ('board', 'post_notice'));