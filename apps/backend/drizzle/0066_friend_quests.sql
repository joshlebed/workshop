CREATE TABLE "friend_quest_completions" (
	"week_start" text NOT NULL,
	"user_low" uuid NOT NULL,
	"user_high" uuid NOT NULL,
	"target" integer NOT NULL,
	"score_count" integer NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"low_seen_at" timestamp with time zone,
	"high_seen_at" timestamp with time zone,
	CONSTRAINT "friend_quest_completions_week_start_user_low_user_high_pk" PRIMARY KEY("week_start","user_low","user_high")
);
--> statement-breakpoint
CREATE TABLE "friend_quests" (
	"week_start" text NOT NULL,
	"user_low" uuid NOT NULL,
	"user_high" uuid NOT NULL,
	"target" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_quests_week_start_user_low_user_high_pk" PRIMARY KEY("week_start","user_low","user_high")
);
--> statement-breakpoint
CREATE TABLE "friend_streak_keepalive_posts" (
	"user_id" uuid NOT NULL,
	"friend_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"streak_days" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_streak_keepalive_posts_user_id_friend_id_period_key_pk" PRIMARY KEY("user_id","friend_id","period_key")
);
--> statement-breakpoint
ALTER TABLE "friend_quest_completions" ADD CONSTRAINT "friend_quest_completions_user_low_users_id_fk" FOREIGN KEY ("user_low") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_quest_completions" ADD CONSTRAINT "friend_quest_completions_user_high_users_id_fk" FOREIGN KEY ("user_high") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_quests" ADD CONSTRAINT "friend_quests_user_low_users_id_fk" FOREIGN KEY ("user_low") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_quests" ADD CONSTRAINT "friend_quests_user_high_users_id_fk" FOREIGN KEY ("user_high") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_streak_keepalive_posts" ADD CONSTRAINT "friend_streak_keepalive_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_streak_keepalive_posts" ADD CONSTRAINT "friend_streak_keepalive_posts_friend_id_users_id_fk" FOREIGN KEY ("friend_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friend_quests_low_idx" ON "friend_quests" USING btree ("user_low","week_start");--> statement-breakpoint
CREATE INDEX "friend_quests_high_idx" ON "friend_quests" USING btree ("user_high","week_start");