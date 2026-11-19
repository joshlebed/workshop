// Head-to-head between two friends: for every game both posted to in a range,
// how often each played, the days they both played, and who took each of
// those days. The rules live here; the route in `routes/v1/friends.ts` only
// checks the friendship and the client renders what it gets.

import type {
  HeadToHeadDay,
  HeadToHeadGame,
  HeadToHeadOutcome,
  HeadToHeadRange,
} from "@workshop/shared/friends";
import { and, gte, inArray, lte } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { gameScores, games } from "../db/schema.js";
import { gameShapeColumns, toGameShape } from "./gameShapes.js";
import { rankEntries } from "./ranking.js";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

interface DayScore {
  scoreValue: number | null;
  parseStatus?: string;
}

/**
 * Who took a day both players posted, by the same rules as the board
 * (`rankEntries`): scores by the game's direction, a loss with no score
 * (`no_result`) behind any score. Two losses are a tie. When either result
 * can't be ranked (an unread share, a legacy row with no value) the day
 * counts as shared but goes to nobody.
 */
export function headToHeadOutcome(
  viewer: DayScore,
  friend: DayScore,
  direction: "asc" | "desc",
): HeadToHeadOutcome {
  const bothLost =
    viewer.scoreValue === null &&
    friend.scoreValue === null &&
    viewer.parseStatus === "no_result" &&
    friend.parseStatus === "no_result";
  if (bothLost) return "tie";
  const ranked = rankEntries(
    [
      { ...viewer, side: "viewer" as const },
      { ...friend, side: "friend" as const },
    ],
    direction,
  );
  const v = ranked.find((e) => e.side === "viewer")?.rank ?? null;
  const f = ranked.find((e) => e.side === "friend")?.rank ?? null;
  if (v === null || f === null) return "none";
  if (v === f) return "tie";
  return v < f ? "win" : "loss";
}

/** `today` minus `days - 1`, as a period key: the first day of an N-day range. */
export function rangeStart(today: string, range: HeadToHeadRange): string | null {
  if (range === "all") return null;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (Number(range) - 1));
  return d.toISOString().slice(0, 10);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export async function loadHeadToHead(
  viewerId: string,
  friendId: string,
  range: HeadToHeadRange,
  today: string,
): Promise<{ from: string | null; games: HeadToHeadGame[] }> {
  const from = rangeStart(today, range);
  const db = getDb();
  const rows = await db
    .select({
      gameId: gameScores.gameId,
      userId: gameScores.userId,
      periodKey: gameScores.periodKey,
      scoreValue: gameScores.scoreValue,
      parseStatus: gameScores.parseStatus,
    })
    .from(gameScores)
    .where(
      and(
        inArray(gameScores.userId, [viewerId, friendId]),
        // Period keys are the poster's local date, so "today" can be a day
        // ahead of the viewer's; nothing later than the viewer's today counts.
        lte(gameScores.periodKey, today),
        from === null ? undefined : gte(gameScores.periodKey, from),
      ),
    );

  type Side = Map<string, DayScore>;
  const byGame = new Map<string, { viewer: Side; friend: Side }>();
  for (const r of rows) {
    if (!DATE_KEY.test(r.periodKey)) continue;
    let entry = byGame.get(r.gameId);
    if (!entry) {
      entry = { viewer: new Map(), friend: new Map() };
      byGame.set(r.gameId, entry);
    }
    const side = r.userId === viewerId ? entry.viewer : entry.friend;
    side.set(r.periodKey, {
      scoreValue: r.scoreValue === null ? null : Number(r.scoreValue),
      ...(r.parseStatus ? { parseStatus: r.parseStatus } : {}),
    });
  }

  const sharedGameIds = [...byGame.entries()]
    .filter(([, e]) => e.viewer.size > 0 && e.friend.size > 0)
    .map(([id]) => id);
  if (sharedGameIds.length === 0) return { from, games: [] };

  const gameRows = await db
    .select(gameShapeColumns)
    .from(games)
    .where(inArray(games.id, sharedGameIds));

  const result: HeadToHeadGame[] = [];
  for (const row of gameRows) {
    const entry = byGame.get(row.id);
    if (!entry) continue;
    const direction = row.scoreDirection === "asc" ? "asc" : "desc";
    const days: HeadToHeadDay[] = [];
    for (const [periodKey, mine] of entry.viewer) {
      const theirs = entry.friend.get(periodKey);
      if (!theirs) continue;
      days.push({
        periodKey,
        outcome: headToHeadOutcome(mine, theirs, direction),
        viewerScore: mine.scoreValue,
        friendScore: theirs.scoreValue,
      });
    }
    days.sort((a, b) => a.periodKey.localeCompare(b.periodKey));
    const numeric = (side: Side) =>
      [...side.values()].flatMap((s) => (s.scoreValue === null ? [] : [s.scoreValue]));
    result.push({
      game: toGameShape(row),
      viewer: { plays: entry.viewer.size, averageScore: average(numeric(entry.viewer)) },
      friend: { plays: entry.friend.size, averageScore: average(numeric(entry.friend)) },
      sharedDays: days.length,
      wins: days.filter((d) => d.outcome === "win").length,
      losses: days.filter((d) => d.outcome === "loss").length,
      ties: days.filter((d) => d.outcome === "tie").length,
      days,
    });
  }
  result.sort(
    (a, b) =>
      b.sharedDays - a.sharedDays ||
      b.viewer.plays + b.friend.plays - (a.viewer.plays + a.friend.plays) ||
      a.game.title.localeCompare(b.game.title),
  );
  return { from, games: result };
}
