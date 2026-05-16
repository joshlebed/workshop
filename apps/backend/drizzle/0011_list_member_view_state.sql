ALTER TABLE "list_members" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "list_members" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "list_members" ADD COLUMN "muted_at" timestamp with time zone;