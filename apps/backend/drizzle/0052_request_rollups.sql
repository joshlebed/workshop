CREATE TABLE "request_rollups" (
	"hour" timestamp with time zone NOT NULL,
	"client" text NOT NULL,
	"platform" text NOT NULL,
	"app_version" text NOT NULL,
	"method" text NOT NULL,
	"route" text NOT NULL,
	"requests" integer NOT NULL,
	"users" integer NOT NULL,
	"errors" integer NOT NULL,
	"avg_ms" integer NOT NULL,
	CONSTRAINT "request_rollups_hour_client_platform_app_version_method_route_pk" PRIMARY KEY("hour","client","platform","app_version","method","route")
);
--> statement-breakpoint
CREATE INDEX "request_rollups_hour_idx" ON "request_rollups" USING btree ("hour");