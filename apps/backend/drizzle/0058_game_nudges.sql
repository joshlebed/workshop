CREATE TABLE "game_nudges" (
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client" text,
	"platform" text,
	"app_version" text,
	CONSTRAINT "game_nudges_sender_id_period_key_game_id_recipient_id_pk" PRIMARY KEY("sender_id","period_key","game_id","recipient_id")
);
--> statement-breakpoint
ALTER TABLE "game_nudges" ADD CONSTRAINT "game_nudges_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_nudges" ADD CONSTRAINT "game_nudges_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_nudges" ADD CONSTRAINT "game_nudges_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_nudges_recipient_idx" ON "game_nudges" USING btree ("recipient_id","created_at");