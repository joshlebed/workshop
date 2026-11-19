-- Refuses to run while any row still holds an inline picture: the
-- `image-backfill` job (the image storage migration (Nov 2026), step 5) must have
-- moved every one into image storage first. Merging this early fails the
-- deploy's migrate job instead of deleting anyone's picture.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "users" WHERE "avatar_url" IS NOT NULL)
     OR EXISTS (SELECT 1 FROM "lists" WHERE "cover_photo_url" IS NOT NULL) THEN
    RAISE EXCEPTION 'inline pictures remain in users.avatar_url or lists.cover_photo_url; run the image-backfill job before this migration';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "lists" DROP COLUMN "cover_photo_url";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "avatar_url";