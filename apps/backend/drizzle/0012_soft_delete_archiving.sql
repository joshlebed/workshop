ALTER TYPE "public"."activity_event_type" ADD VALUE 'list_archived' BEFORE 'member_joined';--> statement-breakpoint
ALTER TYPE "public"."activity_event_type" ADD VALUE 'item_archived' BEFORE 'item_upvoted';--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "archived_at" timestamp with time zone;