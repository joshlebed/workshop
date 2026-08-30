ALTER TABLE "user_identities" ADD COLUMN "provider_client_id" text;--> statement-breakpoint
ALTER TABLE "user_identities" ADD COLUMN "refresh_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "user_identities" ADD COLUMN "refresh_token_updated_at" timestamp with time zone;