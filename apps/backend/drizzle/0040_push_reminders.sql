CREATE TABLE "notification_prefs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"play_reminder_enabled" boolean DEFAULT false NOT NULL,
	"play_reminder_hour" smallint,
	CONSTRAINT "notification_prefs_play_reminder_hour_check" CHECK ("notification_prefs"."play_reminder_hour" BETWEEN 0 AND 23)
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"user_id" uuid NOT NULL,
	"expo_push_token" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_prefs_enabled_hour_idx" ON "notification_prefs" USING btree ("play_reminder_hour") WHERE play_reminder_enabled = true;--> statement-breakpoint
CREATE INDEX "push_tokens_user_last_seen_idx" ON "push_tokens" USING btree ("user_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "game_scores_user_created_idx" ON "game_scores" USING btree ("user_id","created_at");