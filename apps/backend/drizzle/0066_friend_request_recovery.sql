CREATE TABLE "friend_request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"inviter_id" uuid NOT NULL,
	"invitee_id" uuid NOT NULL,
	"request_created_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "friend_requests" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "friend_requests" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "friend_request_events" ADD CONSTRAINT "friend_request_events_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_request_events" ADD CONSTRAINT "friend_request_events_invitee_id_users_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friend_request_events_kind_created_idx" ON "friend_request_events" USING btree ("kind","created_at");--> statement-breakpoint
-- Deliberate: do NOT expire requests that were already pending when this
-- shipped. Their 14-day clock starts now (deploy time); the first
-- friend-request-reminders run after deploy sends each recipient the 48h
-- reminder once. See docs/friend-request-recovery.md.
UPDATE "friend_requests" SET "expires_at" = now() + interval '14 days' WHERE "invitee_id" IS NOT NULL AND "status" = 'pending' AND "expires_at" IS NULL;
