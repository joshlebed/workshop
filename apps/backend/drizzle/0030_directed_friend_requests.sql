ALTER TABLE "friend_requests" ALTER COLUMN "token" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "friend_requests_invitee_idx" ON "friend_requests" USING btree ("invitee_id");--> statement-breakpoint
-- Legacy single-use links could have minted multiple pending rows for the
-- same (inviter, invitee); keep the oldest so the unique index can build.
DELETE FROM "friend_requests" a USING "friend_requests" b
WHERE a.invitee_id IS NOT NULL AND a.status = 'pending'
  AND b.invitee_id = a.invitee_id AND b.inviter_id = a.inviter_id
  AND b.status = 'pending'
  AND (b.created_at < a.created_at OR (b.created_at = a.created_at AND b.id < a.id));--> statement-breakpoint
CREATE UNIQUE INDEX "friend_requests_directed_pending_idx" ON "friend_requests" USING btree ("inviter_id","invitee_id") WHERE invitee_id IS NOT NULL AND status = 'pending';