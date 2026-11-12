-- One ordered list (docs/list-types.md → "Order"). Data only, idempotent: a
-- re-run matches no list and changes nothing.
--
-- `items.position` becomes the one order of a list's open rows. Every row a
-- list displays today gets a position so that the order on screen is
-- unchanged: the Ranked block first (position, ties in the unranked order),
-- then the unranked block in its display order (`order_key` NULLs first,
-- then newest first by `detectedAt` / `created_at`, then id — exactly the old
-- `UNRANKED_ORDER_SQL`). Done rows get the place they would return to when
-- reopened, which is where the old rule put them too.
--
-- Exception: on a list with an attached source, rows a sync brought in that
-- were never ranked and never hand-placed (`order_key IS NULL`) stay
-- `position NULL`: that is the sync inbox ("New from Spotify"). Synced rows
-- are album rows (`kind = 'spotify_album'`) and Letterboxd films
-- (`content -> 'letterboxdSlug'`) that did not come from a member's
-- suggestion (no `item_suggested` event).
--
-- `order_key` gets the same value as `position`. Nothing reads it after this
-- release; mirroring it means the previous backend (during the deploy window,
-- or after a code-only rollback) reads exactly the same order.
--
-- Never touches deleted lists, the two legacy `leaderboard` lists, deleted
-- items, pending suggestions shown in their own section, completion,
-- `archived_at`, content, tags, sources or any `updated_at` (home order).
-- Then the retired `ranking` module is dropped from the lists converted.

WITH eligible AS (
  SELECT l.id,
         ('ranking' = ANY(l.modules)) AS ranking_on,
         ('letterboxd' = ANY(l.modules)) AS letterboxd_on,
         EXISTS (SELECT 1 FROM list_sources s WHERE s.list_id = l.id) AS has_source
  FROM lists l
  WHERE l.archived_at IS NULL
    AND NOT ('leaderboard' = ANY(l.modules))
),
candidates AS (
  SELECT i.id, i.list_id, i.position, i.order_key, i.content, i.created_at,
         e.ranking_on,
         (e.ranking_on AND i.position IS NOT NULL) AS ranked,
         (
           e.has_source
           AND NOT (e.ranking_on AND i.position IS NOT NULL)
           AND i.order_key IS NULL
           AND (
             i.kind = 'spotify_album'
             OR (
               (i.content -> 'letterboxdSlug') IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM activity_events a
                 WHERE a.item_id = i.id AND a.event_type = 'item_suggested'
               )
             )
           )
         ) AS inbox
  FROM items i
  JOIN eligible e ON e.id = i.list_id
  WHERE i.archived_at IS NULL
    AND NOT (e.letterboxd_on AND i.suggestion_state IS NOT DISTINCT FROM 'pending')
),
-- A list still needs converting while it has the `ranking` module or a row it
-- displays without a position. After one run neither holds.
pending_lists AS (
  SELECT DISTINCT c.list_id
  FROM candidates c
  WHERE c.ranking_on OR (c.position IS NULL AND NOT c.inbox)
),
numbered AS (
  SELECT c.id,
         (ROW_NUMBER() OVER (
           PARTITION BY c.list_id
           ORDER BY
             CASE WHEN c.ranked THEN 0 ELSE 1 END,
             CASE WHEN c.ranked THEN c.position END ASC,
             c.order_key ASC NULLS FIRST,
             COALESCE(c.content->>'detectedAt', c.created_at::text) DESC,
             c.id ASC
         ) * 1024)::int AS p
  FROM candidates c
  WHERE NOT c.inbox
    AND c.list_id IN (SELECT list_id FROM pending_lists)
)
UPDATE items
SET position = numbered.p,
    order_key = numbered.p
FROM numbered
WHERE items.id = numbered.id
  AND (items.position IS DISTINCT FROM numbered.p OR items.order_key IS DISTINCT FROM numbered.p);
--> statement-breakpoint
UPDATE lists
SET modules = array_remove(modules, 'ranking')
WHERE 'ranking' = ANY(modules)
  AND archived_at IS NULL
  AND NOT ('leaderboard' = ANY(modules));
