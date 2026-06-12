CREATE TABLE "game_score_reactions" (
	"game_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"score_user_id" uuid NOT NULL,
	"reactor_user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_score_reactions_game_id_period_key_score_user_id_reactor_user_id_pk" PRIMARY KEY("game_id","period_key","score_user_id","reactor_user_id")
);
--> statement-breakpoint
ALTER TABLE "game_score_reactions" ADD CONSTRAINT "game_score_reactions_reactor_user_id_users_id_fk" FOREIGN KEY ("reactor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_score_reactions" ADD CONSTRAINT "game_score_reactions_score_fk" FOREIGN KEY ("game_id","score_user_id","period_key") REFERENCES "public"."game_scores"("game_id","user_id","period_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_score_reactions_score_idx" ON "game_score_reactions" USING btree ("game_id","period_key","score_user_id");