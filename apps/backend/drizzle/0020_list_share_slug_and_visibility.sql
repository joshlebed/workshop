ALTER TABLE "lists" ADD COLUMN "share_slug" text;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "share_visibility" text DEFAULT 'join' NOT NULL;--> statement-breakpoint
DO $$
DECLARE
  r RECORD;
  new_slug TEXT;
  alphabet TEXT := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  i INT;
  attempt INT;
BEGIN
  FOR r IN SELECT id FROM lists WHERE share_slug IS NULL LOOP
    attempt := 0;
    LOOP
      new_slug := '';
      FOR i IN 1..8 LOOP
        new_slug := new_slug || substr(alphabet, 1 + (floor(random() * 62))::int, 1);
      END LOOP;
      BEGIN
        UPDATE lists SET share_slug = new_slug WHERE id = r.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        attempt := attempt + 1;
        IF attempt > 50 THEN
          RAISE EXCEPTION 'could not generate unique share_slug for list %', r.id;
        END IF;
      END;
    END LOOP;
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "lists" ALTER COLUMN "share_slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_share_slug_unique" UNIQUE ("share_slug");--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_share_visibility_check" CHECK ("share_visibility" IN ('off', 'view', 'join'));--> statement-breakpoint
CREATE INDEX "lists_share_slug_idx" ON "lists" USING btree ("share_slug");
