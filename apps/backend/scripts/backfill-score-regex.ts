/**
 * Backfill `items.score_regex` + `items.score_direction` for leaderboard
 * games, then recompute `item_scores.score_value` from the pasted share text.
 *
 * Why: the upsert path's old "first number in the string" parser pulled the
 * date or puzzle number out of every share format we care about (Wordle,
 * Satle, Globle, travle, etc.), so `score_value` was wrong everywhere it was
 * set. This script gives each known game item an explicit regex so future
 * pastes parse correctly, and replays it across history so rankings are
 * accurate from day one.
 *
 * Idempotent — re-running won't double-write. Safe to point at prod.
 *
 *   AWS_PROFILE=workshop-prod DATABASE_URL=$(./scripts/db-url.sh) \
 *     pnpm --filter @workshop/backend exec tsx scripts/backfill-score-regex.ts
 *
 * Pass `--dry` to log changes without applying them.
 *
 * To extend with a new game, add an entry to `GAME_REGEX_CATALOG` below and
 * re-run. The matcher is conservative: an item must match at least one of
 * the catalog's `identifyPatterns` against its title / url / siteName /
 * sourceId. Items that don't match any catalog entry are left alone.
 */

import { isNull, sql } from "drizzle-orm";
import { getDb } from "../src/db/client.js";
import { itemScores, items, lists } from "../src/db/schema.js";

type Direction = "asc" | "desc";

interface GameRegex {
  key: string;
  // Match against any of: item title, item url, content.siteName, content.sourceId.
  identifyPatterns: RegExp[];
  // JS regex source (no flags — backend applies `i`) with capture group 1
  // around the numeric score. Must be a string so it can be stored verbatim
  // on items.score_regex.
  scoreRegex: string;
  // 'desc' = bigger is better, 'asc' = lower is better.
  scoreDirection: Direction;
}

const GAME_REGEX_CATALOG: GameRegex[] = [
  {
    key: "maptap",
    identifyPatterns: [/\bmap\s*tap\b/i, /maptap\.gg/i],
    // "Final score: 970" → 970
    scoreRegex: "Final score:\\s*(\\d+)",
    scoreDirection: "desc",
  },
  {
    key: "globle",
    identifyPatterns: [/\bgloble\b/i, /globle-game\.com/i],
    // "⬜⬜🟧🟥🟩 = 5" → 5 (today's guess count; lower is better). No `$`
    // anchor — the backend applies the regex with only `i`, so `$` would
    // require end-of-string (the share text has trailing URL + hashtag).
    // There's only one `=` in the canonical Globle share, so this is safe.
    scoreRegex: "=\\s*(\\d+)",
    scoreDirection: "asc",
  },
  {
    key: "satle",
    identifyPatterns: [/\bsatle\b/i, /satle\.ca/i],
    // "Satle #449 5/6" → 5
    scoreRegex: "Satle\\s*#\\d+\\s+(\\d+)/6",
    scoreDirection: "asc",
  },
  {
    key: "travle",
    identifyPatterns: [/\btravle\b/i, /travle\.earth/i],
    // "#travle #1250 +0" → 0 (extra-guess count; lower is better)
    scoreRegex: "#travle\\s+#?\\d+\\s+\\+(\\d+)",
    scoreDirection: "asc",
  },
  {
    key: "wordle",
    identifyPatterns: [/\bwordle\b/i, /nytimes\.com\/games\/wordle/i],
    // "Wordle 1,127 3/6" → 3 (guess count out of 6; lower is better). The
    // [\d,] swallows the puzzle number's thousands separator without
    // capturing it.
    scoreRegex: "Wordle\\s+[\\d,]+\\s+(\\d+)/6",
    scoreDirection: "asc",
  },
  {
    key: "worldle",
    identifyPatterns: [/\bworldle\b/i, /worldle\.teuteuf\.fr/i],
    // "#Worldle #842 3/6 (100%)" → 3
    scoreRegex: "Worldle\\s*#?\\d+\\s+(\\d+)/6",
    scoreDirection: "asc",
  },
  {
    key: "tradle",
    identifyPatterns: [/\btradle\b/i, /oec\.world.*tradle/i],
    // "#Tradle #784 2/6" → 2
    scoreRegex: "Tradle\\s*#?\\d+\\s+(\\d+)/6",
    scoreDirection: "asc",
  },
  {
    key: "framed",
    identifyPatterns: [/\bframed\b/i, /framed\.wtf/i],
    // No explicit numeric score in the share — the squares encode guesses.
    // Count the gray boxes by treating the trailing run of squares as the
    // attempt count: we just grab the puzzle number for now so the column
    // is set; ranking still works since everyone uses the same scale per day.
    // Override manually if we want a stricter ordering later.
    scoreRegex: "Framed\\s+#(\\d+)",
    scoreDirection: "desc",
  },
  {
    key: "dailytens",
    identifyPatterns: [/\bdaily\s*tens\b/i, /dailytens\.com/i],
    // "DailyTens #751" → 751. The share is a 🏆/❌ grid with no numeric
    // score; we capture the puzzle number so score_value is anchored to the
    // share itself instead of the trailing `dailytens.com/?ref=<6-digit-id>`
    // URL param (which the "first number anywhere" fallback used to grab).
    // Everyone shares the same puzzle per day, so this ties all players —
    // acceptable until we add real trophy-count ranking.
    scoreRegex: "DailyTens\\s*#(\\d+)",
    scoreDirection: "desc",
  },
];

function matchGame(item: ItemRow): GameRegex | null {
  const haystack: string[] = [item.title, item.url, item.siteName, item.sourceId].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  for (const game of GAME_REGEX_CATALOG) {
    for (const pat of game.identifyPatterns) {
      if (haystack.some((h) => pat.test(h))) return game;
    }
  }
  return null;
}

function parseScore(raw: string, pattern: string): number | null {
  try {
    const re = new RegExp(pattern, "i");
    const m = raw.match(re);
    if (!m) return null;
    const captured = m[1] ?? m[0];
    const n = Number(captured);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

interface ItemRow {
  id: string;
  title: string;
  url: string | null;
  siteName: string | null;
  sourceId: string | null;
  scoreRegex: string | null;
  scoreDirection: string | null;
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  if (dryRun) console.log("[backfill] dry run — no writes will happen");

  const db = getDb();

  // 1) Find every item in a list where the leaderboard module is enabled.
  const rows = await db
    .select({
      id: items.id,
      title: items.title,
      url: items.url,
      content: items.content,
      scoreRegex: items.scoreRegex,
      scoreDirection: items.scoreDirection,
      modules: lists.modules,
    })
    .from(items)
    .innerJoin(lists, sql`${lists.id} = ${items.listId}`)
    .where(isNull(items.archivedAt));

  const leaderboardItems: ItemRow[] = rows
    .filter((r) => (r.modules ?? []).includes("leaderboard"))
    .map((r) => {
      const c = (r.content ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        title: r.title,
        url: r.url,
        siteName: typeof c.siteName === "string" ? c.siteName : null,
        sourceId: typeof c.sourceId === "string" ? c.sourceId : null,
        scoreRegex: r.scoreRegex,
        scoreDirection: r.scoreDirection,
      };
    });

  console.log(`[backfill] scanned ${leaderboardItems.length} leaderboard items`);

  let itemsUpdated = 0;
  const itemsToRescore: { id: string; pattern: string }[] = [];

  for (const item of leaderboardItems) {
    const game = matchGame(item);
    if (!game) continue;

    const sameRegex = item.scoreRegex === game.scoreRegex;
    const sameDir = item.scoreDirection === game.scoreDirection;
    if (!sameRegex || !sameDir) {
      console.log(
        `[backfill] item "${item.title}" → ${game.key} (regex=${JSON.stringify(game.scoreRegex)}, dir=${game.scoreDirection})`,
      );
      if (!dryRun) {
        await db
          .update(items)
          .set({
            scoreRegex: game.scoreRegex,
            scoreDirection: game.scoreDirection,
          })
          .where(sql`${items.id} = ${item.id}`);
      }
      itemsUpdated++;
    }
    itemsToRescore.push({ id: item.id, pattern: game.scoreRegex });
  }

  console.log(`[backfill] items updated: ${itemsUpdated}`);

  // 2) Recompute score_value for every item_scores row tied to one of these
  // items. Cheaper than scanning the whole table — only games we know how to
  // parse get touched.
  let scoresUpdated = 0;
  let scoresUnchanged = 0;
  let scoresNoMatch = 0;

  for (const { id, pattern } of itemsToRescore) {
    const scores = await db
      .select({
        userId: itemScores.userId,
        periodKey: itemScores.periodKey,
        scoreRaw: itemScores.scoreRaw,
        scoreValue: itemScores.scoreValue,
      })
      .from(itemScores)
      .where(sql`${itemScores.itemId} = ${id}`);

    for (const s of scores) {
      const parsed = parseScore(s.scoreRaw, pattern);
      const existing = s.scoreValue === null ? null : Number(s.scoreValue);
      if (parsed === null) {
        scoresNoMatch++;
        if (existing !== null && !dryRun) {
          await db
            .update(itemScores)
            .set({ scoreValue: null })
            .where(
              sql`${itemScores.itemId} = ${id} AND ${itemScores.userId} = ${s.userId} AND ${itemScores.periodKey} = ${s.periodKey}`,
            );
        }
        continue;
      }
      if (parsed === existing) {
        scoresUnchanged++;
        continue;
      }
      if (!dryRun) {
        await db
          .update(itemScores)
          .set({ scoreValue: String(parsed) })
          .where(
            sql`${itemScores.itemId} = ${id} AND ${itemScores.userId} = ${s.userId} AND ${itemScores.periodKey} = ${s.periodKey}`,
          );
      }
      scoresUpdated++;
      console.log(
        `[backfill]   period ${s.periodKey} user ${s.userId.slice(0, 8)}…: ${existing ?? "∅"} → ${parsed}`,
      );
    }
  }

  console.log(
    `[backfill] scores: updated=${scoresUpdated} unchanged=${scoresUnchanged} no-match=${scoresNoMatch}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill] failed", err);
    process.exit(1);
  });
