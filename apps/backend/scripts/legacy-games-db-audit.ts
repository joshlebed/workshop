/**
 * Read-only production audit for the leaderboard-list -> Games migration.
 *
 * Answers the "is it safe to start deleting legacy game-list code/data?"
 * question with prod evidence instead of code intent. Pairs with the
 * structured-log audit in `scripts/legacy-games-audit.sh` (CloudWatch side).
 *
 * STRICTLY READ-ONLY: opens the session with `default_transaction_read_only`
 * so a stray write throws instead of mutating prod. Run it against prod with
 * the SSM connection string:
 *
 *   DATABASE_URL="$(AWS_PROFILE=workshop-prod aws ssm get-parameter \
 *     --name /workshop-prod/db/url --with-decryption \
 *     --query Parameter.Value --output text)" \
 *     pnpm --filter @workshop/backend exec tsx scripts/legacy-games-db-audit.ts
 *
 * (Niteshift sandbox: the assumed role already has ssm:GetParameter, so the
 * inner `aws` call works without a profile.)
 *
 * Invariants checked (see docs/legacy-games-cleanup-audit.md):
 *   1. every historical game (a user has a score for) is in that user's My Games
 *   2. historical game_scores data exists and is queryable
 *   3. user_games order is a stored, stable position (not re-derived per read)
 *   4. the backfill added no automatic friend edges
 *   5. the legacy leaderboard ("geo games") list is intact + game-mapped so the
 *      read bridge still resolves until removal
 *   +  item_scores drop-safety: is anything still backed only by item_scores?
 */

import postgres from "postgres";

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) {
    console.error("DATABASE_URL is required (pull it from SSM /workshop-prod/db/url).");
    process.exit(1);
  }
  return value;
}

const databaseUrl = requireDatabaseUrl();
const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl);
const sql = postgres(databaseUrl, { ssl: isLocalDb ? false : "require", max: 1, idle_timeout: 5 });

function h(title: string): void {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

function table(rows: readonly Record<string, unknown>[]): void {
  if (rows.length === 0) {
    console.log("(no rows)");
    return;
  }
  console.table(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v]))));
}

async function main(): Promise<void> {
  // Safety belt: any accidental write throws "cannot execute ... in a
  // read-only transaction" instead of mutating prod.
  await sql.unsafe("SET default_transaction_read_only = on");

  const host = databaseUrl.replace(/^[^@]*@/, "").replace(/[/?].*$/, "");
  console.log(`legacy-games-db-audit @ ${host}  (read-only)  ${new Date().toISOString()}`);

  h("0. Legacy game-list inventory (item_kind='game' OR 'leaderboard' in modules)");
  table(
    await sql`
      SELECT
        count(*)                                            AS total,
        count(*) FILTER (WHERE archived_at IS NULL)         AS active,
        count(*) FILTER (WHERE archived_at IS NOT NULL)     AS archived,
        count(*) FILTER (WHERE item_kind = 'game')          AS item_kind_game,
        count(*) FILTER (WHERE 'leaderboard' = ANY(modules)) AS module_leaderboard
      FROM lists
      WHERE item_kind = 'game' OR 'leaderboard' = ANY(modules)`,
  );
  console.log("\nPer-list detail (the bridge must keep serving these until removal):");
  table(
    await sql`
      SELECT
        l.id, l.name, l.item_kind, l.modules,
        (l.archived_at IS NOT NULL)        AS archived,
        u.email                            AS owner,
        count(i.id)                        AS active_items,
        count(i.game_id)                   AS items_mapped_to_game,
        count(i.id) - count(i.game_id)     AS items_unmapped
      FROM lists l
      JOIN users u ON u.id = l.owner_id
      LEFT JOIN items i ON i.list_id = l.id AND i.archived_at IS NULL
      WHERE l.item_kind = 'game' OR 'leaderboard' = ANY(l.modules)
      GROUP BY l.id, u.email
      ORDER BY archived, l.name`,
  );

  h("1. INVARIANT — every historically-scored game is in that user's My Games");
  const playedNotInMyGames = await sql`
    SELECT count(*)::int AS played_games_missing_from_my_games
    FROM (SELECT DISTINCT user_id, game_id FROM game_scores) gs
    WHERE NOT EXISTS (
      SELECT 1 FROM user_games ug
      WHERE ug.user_id = gs.user_id AND ug.game_id = gs.game_id
    )`;
  table(playedNotInMyGames);
  console.log("\nIf >0, the rows below are the (user, game) pairs that violate it:");
  table(
    await sql`
      SELECT u.email, g.title, g.normalized_url
      FROM (SELECT DISTINCT user_id, game_id FROM game_scores) gs
      JOIN users u ON u.id = gs.user_id
      JOIN games g ON g.id = gs.game_id
      WHERE NOT EXISTS (
        SELECT 1 FROM user_games ug
        WHERE ug.user_id = gs.user_id AND ug.game_id = gs.game_id)
      LIMIT 50`,
  );

  h("2. INVARIANT — historical game_scores exist and are queryable");
  table(
    await sql`
      SELECT
        count(*)                          AS total_scores,
        count(DISTINCT game_id)           AS distinct_games,
        count(DISTINCT user_id)           AS distinct_users,
        count(DISTINCT period_key)        AS distinct_days,
        min(created_at)::date             AS earliest_day,
        max(period_key)                   AS latest_period_key
      FROM game_scores`,
  );

  h("3. INVARIANT — user_games order is a stored, stable position");
  table(
    await sql`
      SELECT
        count(*)                                        AS rows,
        count(position)                                 AS with_position,
        count(*) FILTER (WHERE position IS NULL)        AS null_position,
        count(DISTINCT user_id)                         AS users
      FROM user_games`,
  );
  console.log(
    "\nPer-user position integrity (duplicate positions would imply an unstable re-sort):",
  );
  table(
    await sql`
      SELECT count(*)::int AS users_with_duplicate_positions
      FROM (
        SELECT user_id, position
        FROM user_games
        WHERE position IS NOT NULL
        GROUP BY user_id, position
        HAVING count(*) > 1
      ) d`,
  );

  h("4. INVARIANT — the backfill added no automatic friend edges");
  table(
    await sql`
      SELECT
        count(*)              AS total_friendships,
        min(created_at)       AS earliest,
        max(created_at)       AS latest
      FROM friendships`,
  );
  console.log("\nFriendships by day (a spike on a backfill/migration day would be suspicious):");
  table(
    await sql`
      SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS edges
      FROM friendships
      GROUP BY 1 ORDER BY 1`,
  );

  h("5. INVARIANT — legacy leaderboard list intact + mapped (bridge still resolves)");
  console.log("Covered by section 0 per-list detail: every active legacy list should show");
  console.log("items_unmapped = 0 (all items resolve to a canonical game via the bridge).");

  h("item_scores DROP-SAFETY — is anything still backed only by item_scores?");
  table(
    await sql`
      SELECT
        count(*)                          AS total_rows,
        count(DISTINCT item_id)           AS distinct_items,
        count(DISTINCT user_id)           AS distinct_users,
        max(updated_at)                   AS last_write
      FROM item_scores`,
  );
  console.log("\nitem_scores split by whether the parent item is mapped to a canonical game:");
  table(
    await sql`
      SELECT
        (i.game_id IS NOT NULL)           AS item_mapped_to_game,
        count(*)::int                     AS score_rows,
        count(DISTINCT s.item_id)::int    AS items,
        max(s.updated_at)                 AS last_write
      FROM item_scores s
      JOIN items i ON i.id = s.item_id
      GROUP BY 1 ORDER BY 1`,
  );
  console.log("\nMapped item_scores NOT yet present in game_scores (should be 0 — migration gap):");
  table(
    await sql`
      SELECT count(*)::int AS unmigrated_mapped_item_scores
      FROM item_scores s
      JOIN items i ON i.id = s.item_id
      WHERE i.game_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM game_scores g
          WHERE g.game_id = i.game_id AND g.user_id = s.user_id AND g.period_key = s.period_key)`,
  );
  console.log("\nUNMAPPED item_scores (item.game_id IS NULL) — the real 'do not drop yet' risk.");
  console.log("These would be non-game / non-migrated scores still living only in item_scores:");
  table(
    await sql`
      SELECT
        l.id AS list_id, l.name AS list_name, l.item_kind, l.modules,
        i.id AS item_id, i.title AS item_title,
        count(*)::int AS score_rows
      FROM item_scores s
      JOIN items i ON i.id = s.item_id
      JOIN lists l ON l.id = i.list_id
      WHERE i.game_id IS NULL
      GROUP BY l.id, i.id
      ORDER BY score_rows DESC
      LIMIT 50`,
  );

  await sql.end({ timeout: 5 });
  console.log("\nDone.");
}

main().catch(async (err) => {
  console.error("audit failed:", err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
