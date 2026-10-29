CREATE TABLE "user_activity_days" (
	"user_id" uuid NOT NULL,
	"client" text NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "user_activity_days_user_id_client_day_pk" PRIMARY KEY("user_id","client","day")
);
--> statement-breakpoint
ALTER TABLE "user_activity_days" ADD CONSTRAINT "user_activity_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_activity_days_client_day_idx" ON "user_activity_days" USING btree ("client","day");--> statement-breakpoint
-- Backfill: activity before this table existed, inferred from content writes.
-- Games activity is attributed to HighScore (the app that owns daily games),
-- list/item activity to Workshop. A lower bound: a user who only read was
-- never recorded. Idempotent (ON CONFLICT DO NOTHING) for the migrate smoke re-run.
INSERT INTO "user_activity_days" ("user_id", "client", "day")
SELECT "user_id", 'highscore', ("created_at" AT TIME ZONE 'UTC')::date FROM "game_scores"
UNION
SELECT "user_id", 'highscore', ("updated_at" AT TIME ZONE 'UTC')::date FROM "game_scores"
UNION
SELECT "reactor_user_id", 'highscore', ("created_at" AT TIME ZONE 'UTC')::date FROM "game_score_reactions"
UNION
SELECT "actor_id", 'workshop', ("created_at" AT TIME ZONE 'UTC')::date FROM "activity_events"
ON CONFLICT DO NOTHING;
