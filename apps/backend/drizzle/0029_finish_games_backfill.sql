-- Finish the leaderboard-list -> Games transition without deleting legacy data.
--
-- 1. Map any remaining score-backed leaderboard items, including archived
--    historical rows that 0027 intentionally skipped for the live list view.
-- 2. Re-copy mapped item_scores into canonical game_scores, idempotently.
-- 3. Make My Games contain every (user, game) with historical scores and seed
--    score-backed game positions by per-user play count, most played first.
--    This is only the initial backfill order; after this migration, app reads
--    use user_games.position and user moves stick. Friend edges are
--    intentionally untouched; users stay solo-only until they accept/share
--    personal friend invites.

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
  AND i.game_id IS NULL
  AND EXISTS (SELECT 1 FROM item_scores s WHERE s.item_id = i.id)
  AND g.normalized_url = c.normalized_url
  AND (
    COALESCE(i.title, '') || ' ' ||
    COALESCE(i.url, '') || ' ' ||
    COALESCE(i.content->>'siteName', '') || ' ' ||
    COALESCE(i.content->>'sourceId', '')
  ) ~* c.identify_pattern;--> statement-breakpoint

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
    AND i.game_id IS NULL
    AND EXISTS (SELECT 1 FROM item_scores s WHERE s.item_id = i.id)
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
),
matched_games AS (
  SELECT id, normalized_url
  FROM games
  WHERE normalized_url IN (SELECT normalized_url FROM valid_unmatched)
  UNION ALL
  SELECT id, normalized_url
  FROM inserted
)
UPDATE items i
SET game_id = g.id
FROM valid_unmatched u
JOIN matched_games g ON g.normalized_url = u.normalized_url
WHERE i.id = u.item_id;--> statement-breakpoint

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

WITH play_counts AS (
  SELECT
    user_id,
    game_id,
    count(*)::int AS play_count,
    min(created_at) AS first_played_at,
    max(updated_at) AS last_played_at
  FROM game_scores
  GROUP BY user_id, game_id
),
ranked_scored AS (
  SELECT
    pc.user_id,
    pc.game_id,
    ((row_number() OVER (
      PARTITION BY pc.user_id
      ORDER BY pc.play_count DESC, pc.last_played_at DESC, pc.first_played_at ASC, pc.game_id
    )) * 1024)::int AS position,
    pc.first_played_at
  FROM play_counts pc
)
INSERT INTO user_games (user_id, game_id, position, added_at)
SELECT
  user_id,
  game_id,
  position,
  COALESCE(first_played_at, now())
FROM ranked_scored
ON CONFLICT (user_id, game_id) DO UPDATE
SET position = EXCLUDED.position;--> statement-breakpoint

WITH play_counts AS (
  SELECT
    user_id,
    game_id,
    count(*)::int AS play_count,
    min(created_at) AS first_played_at,
    max(updated_at) AS last_played_at
  FROM game_scores
  GROUP BY user_id, game_id
),
ranked_scored AS (
  SELECT
    pc.user_id,
    pc.game_id,
    ((row_number() OVER (
      PARTITION BY pc.user_id
      ORDER BY pc.play_count DESC, pc.last_played_at DESC, pc.first_played_at ASC, pc.game_id
    )) * 1024)::int AS position
  FROM play_counts pc
),
max_scored_position AS (
  SELECT user_id, max(position) AS position
  FROM ranked_scored
  GROUP BY user_id
),
unscored AS (
  SELECT
    ug.user_id,
    ug.game_id,
    (
      COALESCE(msp.position, 0) +
      (row_number() OVER (
        PARTITION BY ug.user_id
        ORDER BY ug.position ASC NULLS LAST, ug.added_at ASC, ug.game_id
      ) * 1024)
    )::int AS position
  FROM user_games ug
  LEFT JOIN max_scored_position msp ON msp.user_id = ug.user_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM play_counts pc
    WHERE pc.user_id = ug.user_id
      AND pc.game_id = ug.game_id
  )
)
UPDATE user_games ug
SET position = unscored.position
FROM unscored
WHERE ug.user_id = unscored.user_id
  AND ug.game_id = unscored.game_id;
