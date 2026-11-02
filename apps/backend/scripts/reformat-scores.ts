/**
 * Re-render `score_summary` on rows stored code has already read, with the
 * game's CURRENT format code. For after a formatter change: `admin:game-code`
 * and `admin:handwritten-formatters` only affect new posts, so without this
 * a board shows the old text on every row posted before the change.
 *
 * Display only. It never touches `score_value`, `parse_status`, `score_source`
 * or `code_version` — the reading stays what it was; only the text under the
 * row changes — and it leaves legacy rows (no `parse_status`) to
 * `admin:reread-scores`. Each write is guarded on the row still holding the
 * share text and summary it read. DRY RUN BY DEFAULT.
 *
 *   DATABASE_URL=<url> pnpm --filter @workshop/backend run admin:reformat-scores --game=fermi.gg
 *   … --apply
 *
 * Flags:
 *   --apply          write the changes
 *   --game=<ref>     only this game: uuid, game_key or normalized_url (repeat or
 *                    comma-separate). Without it, every game with format code.
 *   --show=<n>       print up to n changed rows per game (default 3; text only, no user ids)
 */

import { formatShareBodyFallback } from "@workshop/shared/gameRegistry";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "../src/db/client.js";
import { gameScores, games } from "../src/db/schema.js";
import { runFormat, shutdownGameCodeSandbox } from "../src/lib/gameCode/runtime.js";

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
}
const flag = (name: string) => process.argv.includes(name);

async function main() {
  const apply = flag("--apply");
  const show = Number(arg("--show") ?? 3);
  const refs = (arg("--game") ?? "").split(",").filter(Boolean);
  const db = getDb();

  const gameRows = await db
    .select({ id: games.id, title: games.title, formatCode: games.formatCode })
    .from(games)
    .where(
      refs.length === 0
        ? isNotNull(games.formatCode)
        : or(
            inArray(games.gameKey, refs),
            inArray(games.normalizedUrl, refs),
            inArray(
              games.id,
              refs.filter((r) => /^[0-9a-f-]{36}$/i.test(r)),
            ),
          ),
    );
  if (refs.length > 0 && gameRows.length !== refs.length) {
    console.error(`--game matched ${gameRows.length} of ${refs.length} refs`);
    process.exit(1);
  }

  let totalChanged = 0;
  let totalWritten = 0;
  for (const game of gameRows) {
    const rows = await db
      .select({
        userId: gameScores.userId,
        periodKey: gameScores.periodKey,
        scoreRaw: gameScores.scoreRaw,
        scoreSummary: gameScores.scoreSummary,
      })
      .from(gameScores)
      .where(and(eq(gameScores.gameId, game.id), isNotNull(gameScores.parseStatus)));

    const changes: {
      userId: string;
      periodKey: string;
      scoreRaw: string;
      old: string | null;
      next: string | null;
    }[] = [];
    let unavailable = 0;
    for (const row of rows) {
      let next: string | null;
      if (game.formatCode === null) {
        next = formatShareBodyFallback(row.scoreRaw);
      } else {
        const result = await runFormat(game.formatCode, row.scoreRaw);
        if (result.kind === "failed" && result.reason === "sandbox_unavailable") {
          unavailable += 1;
          continue;
        }
        // Same rule as the write path (lib/gameCode/scoring.ts): the code's
        // text, else the cleaned share.
        next = result.kind === "summary" ? result.text : formatShareBodyFallback(row.scoreRaw);
      }
      if (next !== row.scoreSummary) {
        changes.push({
          userId: row.userId,
          periodKey: row.periodKey,
          scoreRaw: row.scoreRaw,
          old: row.scoreSummary,
          next,
        });
      }
    }
    totalChanged += changes.length;
    console.log(
      `${game.title}: ${rows.length} read rows, ${changes.length} summaries change${unavailable ? `, ${unavailable} not checked (sandbox unavailable)` : ""}`,
    );
    for (const c of changes.slice(0, show)) {
      console.log(`  ${JSON.stringify(c.old)}\n    → ${JSON.stringify(c.next)}`);
    }
    if (!apply || changes.length === 0) continue;

    const written = await db.transaction(async (tx) => {
      let n = 0;
      for (const c of changes) {
        const updated = await tx
          .update(gameScores)
          .set({ scoreSummary: c.next })
          .where(
            and(
              eq(gameScores.gameId, game.id),
              eq(gameScores.userId, c.userId),
              eq(gameScores.periodKey, c.periodKey),
              eq(gameScores.scoreRaw, c.scoreRaw),
              sql`${gameScores.scoreSummary} IS NOT DISTINCT FROM ${c.old}`,
            ),
          )
          .returning({ userId: gameScores.userId });
        n += updated.length;
      }
      return n;
    });
    totalWritten += written;
    console.log(
      `  wrote ${written}${written < changes.length ? ` (${changes.length - written} changed since read, left alone)` : ""}`,
    );
  }
  console.log(
    `\n${gameRows.length} games, ${totalChanged} summaries ${apply ? `changed, ${totalWritten} written` : "would change — dry run, nothing written"}`,
  );
}

main()
  .then(async () => {
    await shutdownGameCodeSandbox();
    process.exit(process.exitCode ?? 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
