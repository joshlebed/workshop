-- One row per linked sign-in identity. A single user may have multiple
-- identities (apple + google + the dev-auth synthetic) all pointing to the
-- same user row, so signing in via any of them resolves to the same account.
CREATE TABLE "user_identities" (
	"provider" "auth_provider" NOT NULL,
	"provider_sub" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_identities_provider_provider_sub_pk" PRIMARY KEY("provider","provider_sub")
);
--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_identities_user_idx" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
-- Backfill identities from the legacy columns on users. Verified no duplicate
-- emails exist in prod (2026-05-18) so this is a 1:1 copy.
INSERT INTO "user_identities" ("provider", "provider_sub", "user_id", "created_at")
SELECT "auth_provider", "provider_sub", "id", "created_at" FROM "users";--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email")) WHERE email IS NOT NULL;--> statement-breakpoint
DROP INDEX "users_provider_sub_idx";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "auth_provider";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "provider_sub";
