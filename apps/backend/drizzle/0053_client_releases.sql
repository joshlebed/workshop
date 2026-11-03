CREATE TABLE "client_releases" (
	"client" text NOT NULL,
	"platform" text NOT NULL,
	"latest_version" text,
	"minimum_version" text,
	"store_url" text,
	"message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "client_releases_client_platform_pk" PRIMARY KEY("client","platform"),
	CONSTRAINT "client_releases_client_check" CHECK ("client_releases"."client" in ('workshop', 'highscore')),
	CONSTRAINT "client_releases_platform_check" CHECK ("client_releases"."platform" in ('ios', 'android', 'web'))
);
--> statement-breakpoint
ALTER TABLE "client_releases" ADD CONSTRAINT "client_releases_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;