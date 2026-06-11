/**
 * Recompute stored score values from the verbatim share text (`score_raw`),
 * using the current parser for each game — the shared registry spec for
 * known games (`@workshop/shared/gameRegistry`), the user-taught
 * `games.score_spec` otherwise. Run this whenever a game's scoring rule
 * changes: parsing fixes only apply to new posts until history is replayed.
 *
 * Covers both stores:
 *  - `game_scores` (canonical) — every game with a usable spec.
 *  - `item_scores` (legacy, unmapped items) — parsed via the item's stored
 *    `score_regex` rule string (any generation: bare regex / count: / spec:).
 *
 * Replaces the old `backfill-score-regex.ts`, which only handled
 * `item_scores` and carried its own (drifted) copy of the parser. This one
 * imports the real parser, so it cannot drift.
 *
 * Idempotent — re-running won't double-write. Safe to point at prod.
 *
 *   AWS_PROFILE=workshop-prod DATABASE_URL=$(./scripts/db-url.sh) \
 *     pnpm --filter @workshop/backend exec tsx scripts/rescore-game.ts --game-key=framed
 *
 * Flags:
 *   --game-key=<key>   one registry game (e.g. framed, nyt-mini)
 *   --game-id=<uuid>   one games row by id (user-taught games)
 *   --all              every game with a parser + legacy item_scores
 *   --dry              log changes without applying them
 */

import { specFromStoredRule } from "@workshop/shared/scoreParsing";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../src/db/client.js";
import { gameScores, games, itemScores, items } from "../src/db/schema.js";
import { parseScoreValue, specForGame } from "../src/lib/gameCatalog.js";
import type { DbClient } from "../src/lib/sql.js";

interface Tally {
  updated: number;
  unchanged: number;
  cleared: number;
}

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? (hit.split("=")[1] ?? null) : null;
}

async function rescoreGame(
  db: DbClient,
  game: { id: string; gameKey: string | null; title: string; scoreSpec: unknown },
  dryRun: boolean,
  tally: Tally,
): Promise<void> {
  const spec = specForGame(game);
  if (!spec) {
    console.log(`[rescore] "${game.title}" has no parser — skipped`);
    return;
  }
  const rows = await db
    .select({
      userId: gameScores.userId,
      periodKey: gameScores.periodKey,
      scoreRaw: gameScores.scoreRaw,
      scoreValue: gameScores.scoreValue,
    })
    .from(gameScores)
    .where(eq(gameScores.gameId, game.id));
  console.log(`[rescore] ${game.gameKey ?? game.title}: ${rows.length} game_scores rows`);

  for (const row of rows) {
    const parsed = parseScoreValue(row.scoreRaw, spec);
    const existing = row.scoreValue === null ? null : Number(row.scoreValue);
    if (parsed === existing) {
      tally.unchanged++;
      continue;
    }
    if (!dryRun) {
      await db
        .update(gameScores)
        .set({ scoreValue: parsed === null ? null : String(parsed) })
        .where(
          sql`${gameScores.gameId} = ${game.id} AND ${gameScores.userId} = ${row.userId} AND ${gameScores.periodKey} = ${row.periodKey}`,
        );
    }
    if (parsed === null) tally.cleared++;
    else tally.updated++;
    console.log(
      `[rescore]   ${row.periodKey} user ${row.userId.slice(0, 8)}…: ${existing ?? "∅"} → ${parsed ?? "∅"}`,
    );
  }
}

async function rescoreLegacyItemScores(db: DbClient, dryRun: boolean, tally: Tally) {
  // Unmapped leaderboard items still read/write item_scores; their parser is
  // whatever stored-rule string the item carries.
  const legacyItems = await db
    .select({ id: items.id, title: items.title, scoreRegex: items.scoreRegex })
    .from(items)
    .where(sql`${items.gameId} IS NULL AND ${items.scoreRegex} IS NOT NULL`);
  for (const item of legacyItems) {
    const spec = specFromStoredRule(item.scoreRegex);
    if (!spec) continue;
    const rows = await db
      .select({
        userId: itemScores.userId,
        periodKey: itemScores.periodKey,
        scoreRaw: itemScores.scoreRaw,
        scoreValue: itemScores.scoreValue,
      })
      .from(itemScores)
      .where(eq(itemScores.itemId, item.id));
    if (rows.length > 0) {
      console.log(`[rescore] legacy item "${item.title}": ${rows.length} item_scores rows`);
    }
    for (const row of rows) {
      const parsed = parseScoreValue(row.scoreRaw, spec);
      const existing = row.scoreValue === null ? null : Number(row.scoreValue);
      if (parsed === existing) {
        tally.unchanged++;
        continue;
      }
      if (!dryRun) {
        await db
          .update(itemScores)
          .set({ scoreValue: parsed === null ? null : String(parsed) })
          .where(
            sql`${itemScores.itemId} = ${item.id} AND ${itemScores.userId} = ${row.userId} AND ${itemScores.periodKey} = ${row.periodKey}`,
          );
      }
      if (parsed === null) tally.cleared++;
      else tally.updated++;
      console.log(
        `[rescore]   ${row.periodKey} user ${row.userId.slice(0, 8)}…: ${existing ?? "∅"} → ${parsed ?? "∅"}`,
      );
    }
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  const all = process.argv.includes("--all");
  const gameKey = arg("--game-key");
  const gameId = arg("--game-id");
  if (!all && !gameKey && !gameId) {
    console.error("usage: rescore-game.ts (--game-key=<key> | --game-id=<uuid> | --all) [--dry]");
    process.exit(1);
  }
  if (dryRun) console.log("[rescore] dry run — no writes will happen");

  const db = getDb();
  const tally: Tally = { updated: 0, unchanged: 0, cleared: 0 };

  const targets = await (gameKey
    ? db.select().from(games).where(eq(games.gameKey, gameKey))
    : gameId
      ? db.select().from(games).where(eq(games.id, gameId))
      : db
          .select()
          .from(games)
          .where(sql`${games.gameKey} IS NOT NULL OR ${games.scoreSpec} IS NOT NULL`));
  if (targets.length === 0 && !all) {
    console.error("[rescore] no matching games");
    process.exit(1);
  }

  for (const game of targets) {
    await rescoreGame(db, game, dryRun, tally);
  }
  if (all) {
    await rescoreLegacyItemScores(db, dryRun, tally);
  }

  console.log(
    `[rescore] done: updated=${tally.updated} cleared=${tally.cleared} unchanged=${tally.unchanged}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[rescore] failed", err);
    process.exit(1);
  });
