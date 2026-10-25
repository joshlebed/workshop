// Standings for the Games surface: who the viewer can see, their scores for a
// period with reactions, and the viewer's own streaks. Shared by `GET /v1/games`
// (every game at once) and the score upsert (the one game just posted to, so
// the client can patch its list without refetching it).

import type {
  GameStandings,
  GameStandingsEntry,
  ScoreReactionSummary,
} from "@workshop/shared/games";
import { computeGameStreak, shiftPeriodKey } from "@workshop/shared/games";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { type DbGame, gameScoreReactions, gameScores, users } from "../db/schema.js";
import { toIsoOrNull } from "./dates.js";
import { friendsOf } from "./friends.js";
import { normalizeScoreDirection } from "./gameCatalog.js";
import { scoreCodeFields } from "./gameCodeService.js";
import { rankEntries } from "./ranking.js";
import { teachModeFor } from "./teach/gate.js";
import { scorePickFields } from "./teach/scores.js";

/**
 * The user set whose scores a viewer can see (spec §3.2):
 * `viewer ∪ friends_of(viewer)` (G2a). Everything downstream (standings
 * blocks, the leaderboard endpoint) picks it up unchanged — widening here
 * only grows the user set, never reshapes the response payload.
 */
export async function visibleUserIds(viewerId: string): Promise<string[]> {
  return [viewerId, ...(await friendsOf(viewerId))];
}

/** Map key for a single score `(gameId, scoreUserId)` within a period. */
export function reactionKey(gameId: string, scoreUserId: string): string {
  return `${gameId} ${scoreUserId}`;
}

/**
 * Reaction summaries for every score in `gameIds` on `periodKey`, keyed by
 * `reactionKey(gameId, scoreUserId)`. Reactor identity is gated to `visibleIds`
 * (the viewer's friend graph) so a non-mutual friend's reaction on a shared
 * friend's score never reveals who they are — the same boundary the scores
 * themselves use. Oldest reaction first, so chip order is stable; `viewerReacted`
 * flags the emoji holding the viewer's own current reaction.
 */
export async function loadReactionsForScores(
  viewerId: string,
  gameIds: string[],
  periodKey: string,
  visibleIds: string[],
): Promise<Map<string, ScoreReactionSummary[]>> {
  const byScore = new Map<string, ScoreReactionSummary[]>();
  if (gameIds.length === 0) return byScore;
  const db = getDb();
  const rows = await db
    .select({
      gameId: gameScoreReactions.gameId,
      scoreUserId: gameScoreReactions.scoreUserId,
      reactorUserId: gameScoreReactions.reactorUserId,
      emoji: gameScoreReactions.emoji,
      displayName: users.displayName,
    })
    .from(gameScoreReactions)
    .leftJoin(users, eq(users.id, gameScoreReactions.reactorUserId))
    .where(
      and(
        inArray(gameScoreReactions.gameId, gameIds),
        eq(gameScoreReactions.periodKey, periodKey),
        inArray(gameScoreReactions.scoreUserId, visibleIds),
        inArray(gameScoreReactions.reactorUserId, visibleIds),
      ),
    )
    .orderBy(asc(gameScoreReactions.createdAt));

  for (const r of rows) {
    const key = reactionKey(r.gameId, r.scoreUserId);
    const summaries = byScore.get(key) ?? [];
    let summary = summaries.find((s) => s.emoji === r.emoji);
    if (!summary) {
      summary = { emoji: r.emoji, count: 0, reactors: [], viewerReacted: false };
      summaries.push(summary);
    }
    summary.count += 1;
    summary.reactors.push({ userId: r.reactorUserId, displayName: r.displayName });
    if (r.reactorUserId === viewerId) summary.viewerReacted = true;
    byScore.set(key, summaries);
  }
  return byScore;
}

/**
 * Per-user profile-picture version for standings rows: the first 8 hex chars
 * of `md5(avatar_url)`, null for users without one. Hashed once per user (not
 * per score row) because a data-URL avatar can run to ~1MB.
 */
async function avatarVersionsFor(userIds: string[]): Promise<Map<string, string | null>> {
  const versions = new Map<string, string | null>();
  if (userIds.length === 0) return versions;
  const rows = await getDb()
    .select({
      id: users.id,
      version: sql<string | null>`left(md5(${users.avatarUrl}), 8)`,
    })
    .from(users)
    .where(inArray(users.id, userIds));
  for (const r of rows) versions.set(r.id, r.version);
  return versions;
}

export async function loadStandingsByGame(
  viewerId: string,
  gameIds: string[],
  periodKey: string,
): Promise<Map<string, GameStandingsEntry[]>> {
  const byGame = new Map<string, GameStandingsEntry[]>();
  if (gameIds.length === 0) return byGame;
  const db = getDb();
  const visibleIds = await visibleUserIds(viewerId);
  // Teach v2 fields ride along only for a viewer who has it on.
  const teachOn = teachModeFor(viewerId) === "on";
  const rows = await db
    .select({
      gameId: gameScores.gameId,
      userId: gameScores.userId,
      scoreRaw: gameScores.scoreRaw,
      scoreValue: gameScores.scoreValue,
      parseStatus: gameScores.parseStatus,
      scoreSummary: gameScores.scoreSummary,
      updatedAt: gameScores.updatedAt,
      displayName: users.displayName,
      scoreSource: gameScores.scoreSource,
      pickAdjusted: gameScores.pickAdjusted,
    })
    .from(gameScores)
    .leftJoin(users, eq(users.id, gameScores.userId))
    .where(
      and(
        inArray(gameScores.gameId, gameIds),
        eq(gameScores.periodKey, periodKey),
        inArray(gameScores.userId, visibleIds),
      ),
    );
  const avatarVersions = await avatarVersionsFor([...new Set(rows.map((r) => r.userId))]);
  for (const r of rows) {
    const entries = byGame.get(r.gameId) ?? [];
    entries.push({
      userId: r.userId,
      displayName: r.displayName,
      avatarVersion: avatarVersions.get(r.userId) ?? null,
      scoreRaw: r.scoreRaw,
      scoreValue: r.scoreValue === null ? null : Number(r.scoreValue),
      ...scoreCodeFields(r),
      rank: null,
      updatedAt: toIsoOrNull(r.updatedAt),
      reactions: [],
      ...(teachOn ? scorePickFields(r) : {}),
    });
    byGame.set(r.gameId, entries);
  }

  // Decorate each score with its reactions (G2c). One batched read for the
  // whole period, joined back in-memory by `(gameId, scoreUserId)`. `rankEntries`
  // downstream spreads each entry, so the array survives ranking.
  const reactionsByScore = await loadReactionsForScores(viewerId, gameIds, periodKey, visibleIds);
  for (const [gameId, entries] of byGame) {
    for (const entry of entries) {
      entry.reactions = reactionsByScore.get(reactionKey(gameId, entry.userId)) ?? [];
    }
  }
  return byGame;
}

/**
 * How far back the streak query looks. A daily-game run longer than this is
 * exceptional; a streak that does exceed it is reported as the window length,
 * which is fine for what's ultimately a "keep playing" nudge. The bound keeps
 * the per-request read small (one viewer's own score-days across their games).
 */
const STREAK_LOOKBACK_DAYS = 400;

/**
 * The viewer's consecutive-day play streak per game, as of `today` (see
 * `computeGameStreak`). One batched read of the viewer's own recent score-days
 * across `gameIds`, then the pure day-walk per game. Keyed by gameId; games
 * with no live streak are omitted (the caller defaults them to 0).
 */
export async function loadViewerStreaksByGame(
  viewerId: string,
  gameIds: string[],
  today: string,
): Promise<Map<string, number>> {
  const byGame = new Map<string, number>();
  if (gameIds.length === 0) return byGame;
  const since = shiftPeriodKey(today, -STREAK_LOOKBACK_DAYS);
  const db = getDb();
  const rows = await db
    .select({ gameId: gameScores.gameId, periodKey: gameScores.periodKey })
    .from(gameScores)
    .where(
      and(
        inArray(gameScores.gameId, gameIds),
        eq(gameScores.userId, viewerId),
        gte(gameScores.periodKey, since),
        lte(gameScores.periodKey, today),
      ),
    );
  const daysByGame = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = daysByGame.get(r.gameId) ?? new Set<string>();
    set.add(r.periodKey);
    daysByGame.set(r.gameId, set);
  }
  for (const gameId of gameIds) {
    const streak = computeGameStreak(daysByGame.get(gameId) ?? new Set<string>(), today);
    if (streak > 0) byGame.set(gameId, streak);
  }
  return byGame;
}

/**
 * One game's standings block as `GET /v1/games` would build it — ranked
 * entries, whether the viewer has played, their streak — for `periodKey`.
 * Returned with a score post so the client can write the server's own
 * ranking into its cached list instead of refetching every game.
 */
export async function loadGameStandings(
  viewerId: string,
  game: DbGame,
  periodKey: string,
): Promise<GameStandings> {
  const [standingsByGame, streaksByGame] = await Promise.all([
    loadStandingsByGame(viewerId, [game.id], periodKey),
    loadViewerStreaksByGame(viewerId, [game.id], periodKey),
  ]);
  const entries = rankEntries(
    standingsByGame.get(game.id) ?? [],
    normalizeScoreDirection(game.scoreDirection),
  );
  return {
    periodKey,
    entries,
    viewerHasPlayed: entries.some((e) => e.userId === viewerId),
    viewerStreak: streaksByGame.get(game.id) ?? 0,
  };
}
