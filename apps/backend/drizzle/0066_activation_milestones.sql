CREATE TABLE "push_prompt_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"trigger" text NOT NULL,
	"platform" text,
	"app_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_milestones" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"reached_at" timestamp with time zone DEFAULT now() NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "user_milestones_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "push_prompt_events" ADD CONSTRAINT "push_prompt_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_milestones" ADD CONSTRAINT "user_milestones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_prompt_events_created_idx" ON "push_prompt_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "user_milestones_key_reached_idx" ON "user_milestones" USING btree ("key","reached_at");--> statement-breakpoint
-- Backfill user_milestones from the tables that already record each milestone
-- (live writes go through lib/milestones.ts from here on). Approximate where
-- history was overwritten: second friend / third game come from the edges and
-- games that still exist, push_granted from tokens not yet pruned, and
-- reminders_enabled (no timestamp in notification_prefs) from the "Turn on"
-- answer to the pre-prompt, else the first push token. ON CONFLICT DO NOTHING
-- keeps the migration re-runnable and never overwrites a live row.
INSERT INTO "user_milestones" ("user_id", "key", "reached_at", "context")
SELECT f.user_id, CASE f.rn WHEN 1 THEN 'first_friend' ELSE 'second_friend' END, f.created_at,
  jsonb_build_object('signup_source', u.signup_source, 'client', NULL, 'platform', NULL, 'backfilled', true)
FROM (
  SELECT e.user_id, e.created_at,
    row_number() OVER (PARTITION BY e.user_id ORDER BY e.created_at, e.other_id) AS rn
  FROM (
    SELECT "user_low" AS user_id, "user_high" AS other_id, "created_at" FROM "friendships"
    UNION ALL
    SELECT "user_high", "user_low", "created_at" FROM "friendships"
  ) e
) f
JOIN "users" u ON u.id = f.user_id
WHERE f.rn <= 2
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "user_milestones" ("user_id", "key", "reached_at", "context")
SELECT g.user_id, CASE g.rn WHEN 1 THEN 'first_game' ELSE 'third_game' END, g.added_at,
  jsonb_build_object('signup_source', u.signup_source, 'client', 'highscore', 'platform', NULL, 'backfilled', true)
FROM (
  SELECT "user_id", "added_at",
    row_number() OVER (PARTITION BY "user_id" ORDER BY "added_at", "game_id") AS rn
  FROM "user_games"
) g
JOIN "users" u ON u.id = g.user_id
WHERE g.rn IN (1, 3)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "user_milestones" ("user_id", "key", "reached_at", "context")
SELECT s.user_id, 'first_score', s.created_at,
  jsonb_build_object('signup_source', u.signup_source, 'client', s.client, 'platform', s.platform, 'backfilled', true)
FROM (
  SELECT DISTINCT ON ("user_id") "user_id", "created_at", "client", "platform"
  FROM "game_scores"
  ORDER BY "user_id", "created_at", "game_id"
) s
JOIN "users" u ON u.id = s.user_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "user_milestones" ("user_id", "key", "reached_at", "context")
SELECT fl."user_id", 'first_share_extension_score',
  CASE WHEN fl."value"->>'firstAt' ~ '^\d{4}-\d{2}-\d{2}T' THEN (fl."value"->>'firstAt')::timestamptz ELSE fl."updated_at" END,
  jsonb_build_object('signup_source', u.signup_source, 'client', 'highscore', 'platform', 'ios', 'backfilled', true)
FROM "user_flags" fl
JOIN "users" u ON u.id = fl."user_id"
WHERE fl."key" = 'games.share-extension-score'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "user_milestones" ("user_id", "key", "reached_at", "context")
SELECT t.user_id, 'push_granted', t.created_at,
  jsonb_build_object('signup_source', u.signup_source, 'client', 'highscore', 'platform', t.platform, 'backfilled', true)
FROM (
  SELECT DISTINCT ON ("user_id") "user_id", "created_at", "platform"
  FROM "push_tokens"
  ORDER BY "user_id", "created_at", "expo_push_token"
) t
JOIN "users" u ON u.id = t.user_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "user_milestones" ("user_id", "key", "reached_at", "context")
SELECT p."user_id", 'reminders_enabled',
  COALESCE(
    CASE WHEN fl."value"->>'choice' = 'turn_on' AND fl."value"->>'at' ~ '^\d{4}-\d{2}-\d{2}T'
      THEN (fl."value"->>'at')::timestamptz END,
    (SELECT min(t."created_at") FROM "push_tokens" t WHERE t."user_id" = p."user_id"),
    u."created_at"
  ),
  jsonb_build_object('signup_source', u.signup_source, 'client', 'highscore', 'platform', NULL, 'backfilled', true)
FROM "notification_prefs" p
JOIN "users" u ON u.id = p."user_id"
LEFT JOIN "user_flags" fl ON fl."user_id" = p."user_id" AND fl."key" = 'games.play-reminder-prompted'
WHERE p."play_reminder_enabled" = true
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "user_milestones" ("user_id", "key", "reached_at", "context")
SELECT fl."user_id", 'share_setup_completed',
  CASE WHEN fl."value"->>'completedAt' ~ '^\d{4}-\d{2}-\d{2}T' THEN (fl."value"->>'completedAt')::timestamptz ELSE fl."updated_at" END,
  jsonb_build_object('signup_source', u.signup_source, 'client', 'highscore', 'platform', NULL, 'backfilled', true)
FROM "user_flags" fl
JOIN "users" u ON u.id = fl."user_id"
WHERE fl."key" = 'games.share-sheet-announcement' AND fl."value" ? 'completedAt'
ON CONFLICT DO NOTHING;
