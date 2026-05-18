ALTER TABLE "list_sources" ADD COLUMN "secrets" jsonb;--> statement-breakpoint
ALTER TABLE "list_sources" ADD COLUMN "webhook_slug" text;--> statement-breakpoint
ALTER TABLE "list_sources" ADD COLUMN "sync_schedule" text;--> statement-breakpoint
CREATE UNIQUE INDEX "list_sources_webhook_slug_idx" ON "list_sources" USING btree ("webhook_slug") WHERE webhook_slug IS NOT NULL;