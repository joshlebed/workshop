ALTER TABLE "items" ADD COLUMN "game_id" uuid;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_game_idx" ON "items" USING btree ("game_id");--> statement-breakpoint

-- Map known leaderboard-list items to the canonical Games catalog rows. This
-- is the bridge that lets the old list URLs keep working while future score
-- reads/writes use game_scores and its (game_id, user_id, period_key) PK.
WITH catalog(normalized_url, score_regex, score_direction, identify_pattern) AS (
  VALUES
    ('maptap.gg', 'Final score:\s*(\d+)', 'desc', '(map[[:space:]]*tap|maptap\.gg)'),
    ('globle-game.com', '=\s*(\d+)', 'asc', '(globle|globle-game\.com)'),
    ('satle.ca', 'Satle\s*#\d+\s+(\d+)/6', 'asc', '(satle|satle\.ca)'),
    ('travle.earth', '#travle\s+#?\d+\s+\+(\d+)', 'asc', '(travle|travle\.earth)'),
    ('nytimes.com/games/wordle', 'Wordle\s+[\d,]+\s+(\d+)/6', 'asc', '(wordle|nytimes\.com/games/wordle)'),
    ('worldle.teuteuf.fr', 'Worldle\s*#?\d+\s+(\d+)/6', 'asc', '(worldle|worldle\.teuteuf\.fr)'),
    ('tradle.net', 'Tradle\s*#?\d+\s+(\d+)/6', 'asc', '(tradle|tradle\.net|oec\.world.*tradle)'),
    ('framed.wtf', 'Framed\s+#(\d+)', 'desc', '(framed|framed\.wtf)'),
    ('dailytens.com', 'count:🏆', 'desc', '(daily[[:space:]]*tens|dailytens\.com)')
)
UPDATE items i
SET
  game_id = g.id,
  score_regex = c.score_regex,
  score_direction = c.score_direction
FROM lists l, catalog c, games g
WHERE i.list_id = l.id
  AND 'leaderboard' = ANY(l.modules)
  AND i.archived_at IS NULL
  AND g.normalized_url = c.normalized_url
  AND (
    COALESCE(i.title, '') || ' ' ||
    COALESCE(i.url, '') || ' ' ||
    COALESCE(i.content->>'siteName', '') || ' ' ||
    COALESCE(i.content->>'sourceId', '')
  ) ~* c.identify_pattern;--> statement-breakpoint

-- Any remaining URL-backed leaderboard item is still a game, just not one the
-- parser catalog recognizes yet. Normalize the URL enough to dedupe common
-- http(s), www, query, hash, and trailing-slash variants, then create a
-- generic catalog row so its historical scores also move to game_scores.
WITH unmatched AS (
  SELECT
    i.id AS item_id,
    regexp_replace(
      split_part(
        split_part(
          regexp_replace(lower(i.url), '^https?://(www\.)?', '', 'i'),
          '?',
          1
        ),
        '#',
        1
      ),
      '/$',
      ''
    ) AS normalized_url
  FROM items i
  JOIN lists l ON l.id = i.list_id
  WHERE 'leaderboard' = ANY(l.modules)
    AND i.archived_at IS NULL
    AND i.game_id IS NULL
    AND i.url IS NOT NULL
    AND i.url ~* '^https?://'
),
valid_unmatched AS (
  SELECT item_id, normalized_url
  FROM unmatched
  WHERE normalized_url <> ''
),
inserted AS (
  INSERT INTO games (normalized_url, url, title, game_key, score_direction)
  SELECT DISTINCT
    normalized_url,
    'https://' || normalized_url,
    split_part(normalized_url, '/', 1),
    NULL,
    'desc'
  FROM valid_unmatched
  ON CONFLICT (normalized_url) DO NOTHING
  RETURNING id, normalized_url
)
UPDATE items i
SET game_id = g.id
FROM valid_unmatched u
JOIN games g ON g.normalized_url = u.normalized_url
WHERE i.id = u.item_id;--> statement-breakpoint

-- Preserve historical list scores in the canonical table. If the same user
-- already has more than one legacy item row for a game/day, keep the latest
-- one. If a Games-tab row already exists, only overwrite it when the legacy
-- row is newer.
WITH migrated_scores AS (
  SELECT DISTINCT ON (i.game_id, s.user_id, s.period_key)
    i.game_id,
    s.user_id,
    s.period_key,
    s.score_value,
    s.score_raw,
    s.created_at,
    s.updated_at
  FROM item_scores s
  JOIN items i ON i.id = s.item_id
  WHERE i.game_id IS NOT NULL
  ORDER BY
    i.game_id,
    s.user_id,
    s.period_key,
    s.updated_at DESC,
    s.created_at DESC,
    i.id
)
INSERT INTO game_scores (
  game_id,
  user_id,
  period_key,
  score_value,
  score_raw,
  created_at,
  updated_at
)
SELECT
  game_id,
  user_id,
  period_key,
  score_value,
  score_raw,
  created_at,
  updated_at
FROM migrated_scores
ON CONFLICT (game_id, user_id, period_key) DO UPDATE
SET
  score_value = EXCLUDED.score_value,
  score_raw = EXCLUDED.score_raw,
  updated_at = EXCLUDED.updated_at
WHERE game_scores.updated_at <= EXCLUDED.updated_at;--> statement-breakpoint

-- Put the migrated games in each leaderboard member's personal Games tab so
-- the new surface has the same playable set as the old geo-games list.
INSERT INTO user_games (user_id, game_id, position, added_at)
SELECT DISTINCT ON (m.user_id, i.game_id)
  m.user_id,
  i.game_id,
  i.position,
  COALESCE(i.created_at, now())
FROM items i
JOIN lists l ON l.id = i.list_id
JOIN list_members m ON m.list_id = i.list_id
WHERE 'leaderboard' = ANY(l.modules)
  AND i.archived_at IS NULL
  AND i.game_id IS NOT NULL
ORDER BY
  m.user_id,
  i.game_id,
  i.position ASC NULLS LAST,
  i.created_at ASC
ON CONFLICT (user_id, game_id) DO NOTHING;
