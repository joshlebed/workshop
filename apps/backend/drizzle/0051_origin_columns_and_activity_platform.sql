ALTER TABLE "game_scores" ADD COLUMN "client" text;--> statement-breakpoint
ALTER TABLE "game_scores" ADD COLUMN "platform" text;--> statement-breakpoint
ALTER TABLE "game_scores" ADD COLUMN "app_version" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "client" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "platform" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "app_version" text;--> statement-breakpoint
ALTER TABLE "user_activity_days" ADD COLUMN "platform" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_activity_days" ADD COLUMN "app_version" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_activity_days" DROP CONSTRAINT "user_activity_days_user_id_client_day_pk";--> statement-breakpoint
ALTER TABLE "user_activity_days" ADD CONSTRAINT "user_activity_days_user_id_client_platform_app_version_day_pk" PRIMARY KEY("user_id","client","platform","app_version","day");
