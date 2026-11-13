-- Every users.display_name is NULL (not chosen yet → onboarding) or a real
-- name: at least one non-whitespace character, at most 40 characters. The
-- full rule lives in src/lib/displayName.ts; this is the database backstop.
--
-- A whitespace-only name was never a name: clear it so the user is asked
-- for one (needsDisplayName).
UPDATE "users" SET "display_name" = NULL, "updated_at" = now() WHERE "display_name" !~ '[^[:space:]]';--> statement-breakpoint
-- An over-long name is a real name we won't silently truncate. Stop here so an
-- operator decides what to do with it (the prod copy on 2026-11-13 had none;
-- the longest was 23 characters).
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM "users" WHERE char_length("display_name") > 40;
  IF n > 0 THEN
    RAISE EXCEPTION 'users_display_name_check: % user(s) have a display_name longer than 40 characters; fix them by hand before applying this migration', n;
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_display_name_check" CHECK ("users"."display_name" IS NULL OR ("users"."display_name" ~ '[^[:space:]]' AND char_length("users"."display_name") <= 40));
