CREATE TABLE "game_direction_requests" (
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_direction_requests_game_id_user_id_pk" PRIMARY KEY("game_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "game_scores" ADD COLUMN "pick" jsonb;--> statement-breakpoint
ALTER TABLE "game_scores" ADD COLUMN "pick_is_example" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "game_scores" ADD COLUMN "pick_adjusted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "parse_conflict_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "direction_set_by" uuid;--> statement-breakpoint
ALTER TABLE "game_direction_requests" ADD CONSTRAINT "game_direction_requests_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_direction_requests" ADD CONSTRAINT "game_direction_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_direction_set_by_users_id_fk" FOREIGN KEY ("direction_set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;