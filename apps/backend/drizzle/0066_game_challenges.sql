CREATE TABLE "challenge_accepts" (
	"challenge_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"friendship_created" boolean DEFAULT false NOT NULL,
	"game_added" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client" text,
	"platform" text,
	"app_version" text,
	CONSTRAINT "challenge_accepts_challenge_id_user_id_pk" PRIMARY KEY("challenge_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "game_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"challenger_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"score_value" numeric,
	"score_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "game_challenges_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "challenge_accepts" ADD CONSTRAINT "challenge_accepts_challenge_id_game_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."game_challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_accepts" ADD CONSTRAINT "challenge_accepts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_challenges" ADD CONSTRAINT "game_challenges_challenger_id_users_id_fk" FOREIGN KEY ("challenger_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_challenges" ADD CONSTRAINT "game_challenges_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "challenge_accepts_user_idx" ON "challenge_accepts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "game_challenges_challenger_game_period_idx" ON "game_challenges" USING btree ("challenger_id","game_id","period_key");