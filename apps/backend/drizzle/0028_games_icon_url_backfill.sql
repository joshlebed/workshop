-- Backfill `games.icon_url` for rows created before the find-or-create path
-- learned to set it (the Games tab rendered the 🎮 fallback glyph for every
-- card). Google's s2 favicon endpoint always returns a raster (the generic
-- globe for unknown hosts), and a normalized lowercase hostname needs no URL
-- encoding. Kept in sync with `defaultGameIconUrl` in `lib/gameCatalog.ts`.
-- Idempotent: only touches rows still missing an icon.
UPDATE "games"
SET "icon_url" = 'https://www.google.com/s2/favicons?domain='
  || split_part(split_part("normalized_url", '/', 1), ':', 1)
  || '&sz=128'
WHERE "icon_url" IS NULL;
