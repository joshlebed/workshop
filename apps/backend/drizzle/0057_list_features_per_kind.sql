-- Features per list kind (docs/list-types.md, `@workshop/shared/listKinds`).
-- Data only, idempotent: a re-run matches no rows. Never touches a list with
-- the retired `leaderboard` module, never deletes items, completion, positions,
-- order keys or sources, and leaves `updated_at` alone so home order holds.

-- 1. Letterboxd match is offered only on movie lists.
UPDATE lists
SET modules = array_remove(modules, 'letterboxd')
WHERE 'letterboxd' = ANY(modules)
  AND item_kind IS DISTINCT FROM 'movie'
  AND NOT ('leaderboard' = ANY(modules));
--> statement-breakpoint
-- 2. Letterboxd match owns a `letterboxd_match` source. A movie list with the
--    feature on but no such source gets one (it syncs on "Check for matches").
INSERT INTO list_sources (list_id, kind, config)
SELECT l.id, 'letterboxd_match', '{}'::jsonb
FROM lists l
WHERE 'letterboxd' = ANY(l.modules)
  AND l.item_kind = 'movie'
  AND NOT ('leaderboard' = ANY(l.modules))
  AND NOT EXISTS (
    SELECT 1 FROM list_sources s WHERE s.list_id = l.id AND s.kind = 'letterboxd_match'
  );
--> statement-breakpoint
-- 3. `sources` is derived: off when nothing is attached ...
UPDATE lists
SET modules = array_remove(modules, 'sources')
WHERE 'sources' = ANY(modules)
  AND NOT ('leaderboard' = ANY(modules))
  AND NOT EXISTS (SELECT 1 FROM list_sources s WHERE s.list_id = lists.id);
--> statement-breakpoint
-- ... and on when something is, in `MODULE_NAMES` order.
UPDATE lists
SET modules = ARRAY(
  SELECT u.m
  FROM unnest(modules || ARRAY['sources']::text[]) WITH ORDINALITY AS u(m, o)
  ORDER BY array_position(ARRAY['todo', 'ranking', 'leaderboard', 'sources', 'letterboxd']::text[], u.m) NULLS LAST, u.o
)
WHERE NOT ('sources' = ANY(modules))
  AND NOT ('leaderboard' = ANY(modules))
  AND EXISTS (SELECT 1 FROM list_sources s WHERE s.list_id = lists.id);
