// Games surface (spec §3, G1a + G2a) — global catalog + "My Games" + scores.
// Legacy leaderboard-list items now map into this catalog through items.game_id,
// but this router still only owns the Games surface tables directly.
// Standings cover `viewer ∪ friends_of(viewer)` (G2a) in the G1a shape.

import type {
  AddGameResponse,
  DiscoveryGame,
  GameDiscoveryResponse,
  GameLeaderboardResponse,
  GameScore,
  GameStandings,
  GameStandingsEntry,
  GamesResponse,
  MyGame,
  ScoreReactionSummary,
  SetGameScoreSpecResponse,
  SetScoreReactionResponse,
  UpsertGameScoreResponse,
} from "@workshop/shared/games";
import {
  computeGameStreak,
  isReactionEmoji,
  normalizeGameUrl,
  shiftPeriodKey,
} from "@workshop/shared/games";
import { parseScoreWithSpec, scoreSpecSchema } from "@workshop/shared/scoreParsing";
import { evaluateSummarySpec, summarySpecSchema } from "@workshop/shared/summarySpec";
import { and, asc, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import {
  gameScoreReactions,
  gameScores,
  gameSpecRevisions,
  games,
  userGames,
  users,
} from "../../db/schema.js";
import { getConfig } from "../../lib/config.js";
import { toIsoOrNull, toIsoString } from "../../lib/dates.js";
import { friendsOf } from "../../lib/friends.js";
import {
  catalogEntryForKey,
  findOrCreateGame,
  type GameMetadataHints,
  normalizeScoreDirection,
  parseScoreValue,
  specForGame,
} from "../../lib/gameCatalog.js";
import { moveUserGamePosition } from "../../lib/gamePositions.js";
import { todayPeriodKey, toGameShape } from "../../lib/gameShapes.js";
import {
  notifyFirstScore,
  notifyGameAdded,
  notifyScoreSpecTaught,
  opsNotificationsEnabled,
  userHasAnyScore,
} from "../../lib/opsNotifications.js";
import { rankEntries } from "../../lib/ranking.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { periodKeySchema, scoreRawSchema, upsertScoreSchema } from "../../lib/scoreSchemas.js";
import { parseAndValidateUrl } from "../../lib/ssrf-guard.js";
import { addToMyGames } from "../../lib/userGames.js";
import { requireAuth } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { resolveLinkPreview } from "./link-preview.js";

const addGameSchema = z.object({
  url: z.string().min(1, "url required").max(2000, "url too long"),
});

const setScoreSpecSchema = z.object({
  spec: scoreSpecSchema,
  /**
   * The share the user taught from. The spec must reproduce `expectedValue`
   * on it — a spec that can't parse its own teaching example is never stored.
   */
  exampleRaw: scoreRawSchema,
  expectedValue: z.number().finite(),
  scoreDirection: z.enum(["asc", "desc"]),
  /**
   * Optional taught recap formatter (the display-side twin of `spec`) — see
   * `@workshop/shared/summarySpec`. Must produce a non-empty summary on
   * `exampleRaw`; absent/null clears any previously taught one, so a re-teach
   * never leaves a stale formatter behind a fresh parser.
   */
  summarySpec: summarySpecSchema.nullish(),
});

const moveGameSchema = z.object({
  beforeGameId: z.union([z.string().uuid(), z.null()]).optional(),
  afterGameId: z.union([z.string().uuid(), z.null()]).optional(),
});

const reactionEmojiSchema = z.object({
  emoji: z.string().trim().min(1).max(32).refine(isReactionEmoji, "invalid reaction emoji"),
});

const uuidSchema = z.string().uuid();

function toScoreShape(row: {
  gameId: string;
  userId: string;
  periodKey: string;
  scoreValue: string | null;
  scoreRaw: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}): GameScore {
  return {
    gameId: row.gameId,
    userId: row.userId,
    periodKey: row.periodKey,
    scoreValue: row.scoreValue === null ? null : Number(row.scoreValue),
    scoreRaw: row.scoreRaw,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

/**
 * The user set whose scores a viewer can see (spec §3.2):
 * `viewer ∪ friends_of(viewer)` (G2a). Everything downstream (standings
 * blocks, the leaderboard endpoint) picks it up unchanged — widening here
 * only grows the user set, never reshapes the response payload.
 */
async function visibleUserIds(viewerId: string): Promise<string[]> {
  return [viewerId, ...(await friendsOf(viewerId))];
}

/** Map key for a single score `(gameId, scoreUserId)` within a period. */
function reactionKey(gameId: string, scoreUserId: string): string {
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
async function loadReactionsForScores(
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

async function loadStandingsByGame(
  viewerId: string,
  gameIds: string[],
  periodKey: string,
): Promise<Map<string, GameStandingsEntry[]>> {
  const byGame = new Map<string, GameStandingsEntry[]>();
  if (gameIds.length === 0) return byGame;
  const db = getDb();
  const visibleIds = await visibleUserIds(viewerId);
  const rows = await db
    .select({
      gameId: gameScores.gameId,
      userId: gameScores.userId,
      scoreRaw: gameScores.scoreRaw,
      scoreValue: gameScores.scoreValue,
      updatedAt: gameScores.updatedAt,
      displayName: users.displayName,
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
  for (const r of rows) {
    const entries = byGame.get(r.gameId) ?? [];
    entries.push({
      userId: r.userId,
      displayName: r.displayName,
      scoreRaw: r.scoreRaw,
      scoreValue: r.scoreValue === null ? null : Number(r.scoreValue),
      rank: null,
      updatedAt: toIsoOrNull(r.updatedAt),
      reactions: [],
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
async function loadViewerStreaksByGame(
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

export const gameRoutes = new Hono();

// Flag gate (spec §3: "flag-gated; never touches the old surface"). 404 —
// not 403 — so the surface is indistinguishable from absent when off.
gameRoutes.use("*", async (c, next) => {
  const config = getConfig();
  if (!config.isLocal && !config.gamesEnabled) {
    return err(c, "NOT_FOUND", "not found");
  }
  await next();
});
gameRoutes.use("*", requireAuth);

gameRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const periodRaw = c.req.query("period");
  let periodKey = todayPeriodKey();
  if (periodRaw !== undefined) {
    const parsed = periodKeySchema.safeParse(periodRaw);
    if (!parsed.success) return err(c, "VALIDATION", "invalid period");
    periodKey = parsed.data;
  }

  const db = getDb();
  const rows = await db
    .select({ game: games, position: userGames.position, addedAt: userGames.addedAt })
    .from(userGames)
    .innerJoin(games, eq(games.id, userGames.gameId))
    .where(eq(userGames.userId, userId))
    .orderBy(
      sql`${userGames.position} ASC NULLS LAST`,
      asc(userGames.addedAt),
      asc(userGames.gameId),
    );

  const gameIds = rows.map((r) => r.game.id);
  const [standingsByGame, streaksByGame] = await Promise.all([
    loadStandingsByGame(userId, gameIds, periodKey),
    loadViewerStreaksByGame(userId, gameIds, periodKey),
  ]);

  const myGames: MyGame[] = rows.map((r) => {
    const entries = rankEntries(
      standingsByGame.get(r.game.id) ?? [],
      normalizeScoreDirection(r.game.scoreDirection),
    );
    const standings: GameStandings = {
      periodKey,
      entries,
      viewerHasPlayed: entries.some((e) => e.userId === userId),
      viewerStreak: streaksByGame.get(r.game.id) ?? 0,
    };
    return {
      gameId: r.game.id,
      position: r.position,
      addedAt: toIsoString(r.addedAt),
      game: toGameShape(r.game),
      standings,
    };
  });

  const response: GamesResponse = { periodKey, games: myGames };
  return ok(c, response);
});

/**
 * GET /v1/games/discovery (G2a) — games my friends play, each with which
 * friends play it, ranked by how many friends play each. By default the feed
 * omits games I already added (it's the "what could I add" list). `?includeOwned=1`
 * keeps owned games in the ranked list (tagged `inMyGames`, sorted after every
 * addable game) so the + add-game sheet can show the *full* picture of what my
 * friends play, not just the addable remainder — the common case (you already
 * play everything your friends do) otherwise renders an empty suggestions
 * section. `?friend=<userId>` narrows
 * to one friend and 404s for anyone who isn't a friend (a non-friend must not be
 * able to probe whether the id plays anything). Registered before the
 * `/:id` routes so the literal path isn't shadowed.
 */
gameRoutes.get("/discovery", async (c) => {
  const userId = c.get("userId");
  const friendIds = await friendsOf(userId);

  const friendFilter = c.req.query("friend");
  let scopedFriendIds = friendIds;
  let scopedFriendId: string | undefined;
  if (friendFilter !== undefined) {
    const parsed = uuidSchema.safeParse(friendFilter);
    if (!parsed.success || !friendIds.includes(parsed.data)) {
      return err(c, "NOT_FOUND", "friend not found");
    }
    scopedFriendIds = [parsed.data];
    scopedFriendId = parsed.data;
  }

  const includeOwnedFlag = c.req.query("includeOwned");
  const includeOwned = includeOwnedFlag === "1" || includeOwnedFlag === "true";

  const db = getDb();

  // For the single-friend form, also report how many games that friend has
  // total — the UI uses it to distinguish "friend has no games" from "friend
  // has games but you already have them all" (both leave `games` empty below).
  const friendGameCount =
    scopedFriendId === undefined
      ? undefined
      : ((
          await db
            .select({ n: sql<number>`count(*)::int` })
            .from(userGames)
            .where(eq(userGames.userId, scopedFriendId))
        )[0]?.n ?? 0);

  // `exactOptionalPropertyTypes` — only attach friendGameCount when defined.
  const countField = friendGameCount === undefined ? {} : { friendGameCount };

  if (scopedFriendIds.length === 0) {
    const response: GameDiscoveryResponse = { games: [], ...countField };
    return ok(c, response);
  }

  // For the includeOwned feed we need the viewer's owned game-id set in hand to
  // tag each row; the default feed keeps the SQL subquery filter (byte-identical
  // to before, and sidesteps any empty-array edge case).
  let ownedIds: Set<string> | null = null;
  let friendGamesWhere = and(
    inArray(userGames.userId, scopedFriendIds),
    notInArray(
      userGames.gameId,
      db.select({ gameId: userGames.gameId }).from(userGames).where(eq(userGames.userId, userId)),
    ),
  );
  if (includeOwned) {
    const owned = await db
      .select({ gameId: userGames.gameId })
      .from(userGames)
      .where(eq(userGames.userId, userId));
    ownedIds = new Set(owned.map((r) => r.gameId));
    friendGamesWhere = inArray(userGames.userId, scopedFriendIds);
  }

  const rows = await db
    .select({
      game: games,
      friendId: userGames.userId,
      displayName: users.displayName,
      addedAt: userGames.addedAt,
    })
    .from(userGames)
    .innerJoin(games, eq(games.id, userGames.gameId))
    .leftJoin(users, eq(users.id, userGames.userId))
    .where(friendGamesWhere)
    .orderBy(asc(userGames.addedAt), asc(userGames.gameId));

  const byGame = new Map<string, DiscoveryGame>();
  for (const r of rows) {
    const entry = byGame.get(r.game.id) ?? {
      game: toGameShape(r.game),
      friends: [],
      inMyGames: ownedIds?.has(r.game.id) ?? false,
    };
    entry.friends.push({ userId: r.friendId, displayName: r.displayName });
    byGame.set(r.game.id, entry);
  }
  // Addable games first — owned rows (includeOwned feed only) sink to the
  // bottom so the add-game sheet leads with what the user can actually add.
  // Within each group: most-played-among-friends first; stable tiebreak on title.
  const discovered = [...byGame.values()].sort(
    (a, b) =>
      Number(a.inMyGames) - Number(b.inMyGames) ||
      b.friends.length - a.friends.length ||
      a.game.title.localeCompare(b.game.title),
  );

  const response: GameDiscoveryResponse = { games: discovered, ...countField };
  return ok(c, response);
});

/**
 * Best-effort display metadata for a brand-new catalog row — the same
 * SSRF-guarded, 7-day-cached link-preview pipeline the Lists tab uses for
 * item thumbnails. Only invoked when the URL doesn't match an existing games
 * row (lazy hints), and failure just falls back to hostname title + Google
 * favicon, so adding a game never breaks on a slow/blocked site.
 */
async function previewHintsFor(
  rawUrl: string,
  normalizedUrl: string,
): Promise<GameMetadataHints | null> {
  try {
    // normalizeGameUrl accepts scheme-less input ("wordle.com"); re-add the
    // scheme before SSRF validation.
    const withScheme = /^https?:\/\//i.test(rawUrl.trim())
      ? rawUrl.trim()
      : `https://${normalizedUrl}`;
    const preview = await resolveLinkPreview(parseAndValidateUrl(withScheme));
    return { title: preview.title, iconUrl: preview.favicon };
  } catch {
    return null;
  }
}

gameRoutes.post(
  "/",
  rateLimit({
    family: "v1.games.add",
    limit: 60,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const userId = c.get("userId");
    const parsed = await parseJsonBody(c, addGameSchema);
    if (!parsed.ok) return parsed.response;

    const normalized = normalizeGameUrl(parsed.data.url);
    if (!normalized) return err(c, "VALIDATION", "url is not a valid http(s) game URL");

    const game = await findOrCreateGame(parsed.data.url, normalized, getDb(), () =>
      previewHintsFor(parsed.data.url, normalized),
    );
    const membership = await addToMyGames(userId, game.id);
    if (membership.created) await notifyGameAdded(userId, game.title);

    const response: AddGameResponse = {
      game: toGameShape(game),
      userGame: {
        gameId: game.id,
        position: membership.position,
        addedAt: toIsoString(membership.addedAt),
      },
    };
    return ok(c, response, 201);
  },
);

gameRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const gameId = uuidSchema.safeParse(c.req.param("id"));
  if (!gameId.success) return err(c, "NOT_FOUND", "game not found");

  const db = getDb();
  // Removes only my user_games row — the global catalog row and my historical
  // scores stay (re-adding the game brings the history back).
  await db
    .delete(userGames)
    .where(and(eq(userGames.userId, userId), eq(userGames.gameId, gameId.data)));
  return ok(c, { ok: true });
});

gameRoutes.post(
  "/:id/move",
  rateLimit({
    family: "v1.games.move",
    limit: 240,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const userId = c.get("userId");
    const gameId = uuidSchema.safeParse(c.req.param("id"));
    if (!gameId.success) return err(c, "NOT_FOUND", "game not found");

    const parsed = await parseJsonBody(c, moveGameSchema);
    if (!parsed.ok) return parsed.response;

    const db = getDb();
    const [mine] = await db
      .select({ gameId: userGames.gameId })
      .from(userGames)
      .where(and(eq(userGames.userId, userId), eq(userGames.gameId, gameId.data)))
      .limit(1);
    if (!mine) return err(c, "NOT_FOUND", "game not in your list");

    const result = await moveUserGamePosition({
      userId,
      gameId: gameId.data,
      beforeGameId: parsed.data.beforeGameId ?? null,
      afterGameId: parsed.data.afterGameId ?? null,
      db,
    });
    return ok(c, { position: result.position, rebalanced: result.rebalanced });
  },
);

gameRoutes.put(
  "/:id/scores",
  rateLimit({
    family: "v1.games.scores.upsert",
    limit: 60,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const userId = c.get("userId");
    const gameId = uuidSchema.safeParse(c.req.param("id"));
    if (!gameId.success) return err(c, "NOT_FOUND", "game not found");

    const parsed = await parseJsonBody(c, upsertScoreSchema);
    if (!parsed.ok) return parsed.response;

    const db = getDb();
    const [game] = await db.select().from(games).where(eq(games.id, gameId.data)).limit(1);
    if (!game) return err(c, "NOT_FOUND", "game not found");

    const value = parseScoreValue(parsed.data.scoreRaw, specForGame(game));

    // Capture activation state BEFORE the upsert — false means this is the
    // user's first score ever (see userHasAnyScore for the tables it spans).
    // The `&&` skips the existence query when no operator webhook is set, so
    // the steady-state hot path pays nothing extra.
    const isFirstScore = opsNotificationsEnabled() && !(await userHasAnyScore(userId, db));
    const now = new Date();
    const [row] = await db
      .insert(gameScores)
      .values({
        gameId: game.id,
        userId,
        periodKey: parsed.data.periodKey,
        scoreRaw: parsed.data.scoreRaw,
        scoreValue: value === null ? null : String(value),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [gameScores.gameId, gameScores.userId, gameScores.periodKey],
        set: {
          scoreRaw: parsed.data.scoreRaw,
          scoreValue: value === null ? null : String(value),
          updatedAt: now,
        },
      })
      .returning();
    if (!row) return err(c, "INTERNAL", "score upsert returned no row");

    // Posting a score auto-adds the game to My Games (spec §3.5) — no
    // membership prerequisite, idempotent if it's already there.
    await addToMyGames(userId, game.id);
    if (isFirstScore) await notifyFirstScore(userId, game.title);

    const response: UpsertGameScoreResponse = { score: toScoreShape(row) };
    return ok(c, response);
  },
);

gameRoutes.get("/:id/leaderboard", async (c) => {
  const userId = c.get("userId");
  const gameId = uuidSchema.safeParse(c.req.param("id"));
  if (!gameId.success) return err(c, "NOT_FOUND", "game not found");

  const periodRaw = c.req.query("period");
  let periodKey = todayPeriodKey();
  if (periodRaw !== undefined) {
    const parsed = periodKeySchema.safeParse(periodRaw);
    if (!parsed.success) return err(c, "VALIDATION", "invalid period");
    periodKey = parsed.data;
  }

  const db = getDb();
  const [game] = await db.select().from(games).where(eq(games.id, gameId.data)).limit(1);
  if (!game) return err(c, "NOT_FOUND", "game not found");

  const byGame = await loadStandingsByGame(userId, [game.id], periodKey);
  const entries = rankEntries(
    byGame.get(game.id) ?? [],
    normalizeScoreDirection(game.scoreDirection),
  );

  const response: GameLeaderboardResponse = { gameId: game.id, periodKey, entries };
  return ok(c, response);
});

/** Viewer-relative reaction summary for one score (drives the PUT/DELETE echo). */
async function reactionsForOneScore(
  viewerId: string,
  gameId: string,
  scoreUserId: string,
  periodKey: string,
): Promise<ScoreReactionSummary[]> {
  const visibleIds = await visibleUserIds(viewerId);
  const byScore = await loadReactionsForScores(viewerId, [gameId], periodKey, visibleIds);
  return byScore.get(reactionKey(gameId, scoreUserId)) ?? [];
}

/**
 * PUT /v1/games/:id/reactions/:periodKey/:scoreUserId (G2c) — set or replace
 * the viewer's emoji reaction on a friend's score. One reaction per reactor per
 * score (tapback): re-reacting upserts the emoji. Gated to the friend graph and
 * to a real score — a stranger or a missing score both 404 so the endpoint
 * can't probe. Reacting to your own score is rejected outright.
 */
gameRoutes.put(
  "/:id/reactions/:periodKey/:scoreUserId",
  rateLimit({
    family: "v1.games.reactions.set",
    limit: 120,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const userId = c.get("userId");
    const gameId = uuidSchema.safeParse(c.req.param("id"));
    if (!gameId.success) return err(c, "NOT_FOUND", "game not found");
    const scoreUserId = uuidSchema.safeParse(c.req.param("scoreUserId"));
    if (!scoreUserId.success) return err(c, "NOT_FOUND", "score not found");
    const periodKey = periodKeySchema.safeParse(c.req.param("periodKey"));
    if (!periodKey.success) return err(c, "VALIDATION", "invalid period");

    const parsed = await parseJsonBody(c, reactionEmojiSchema);
    if (!parsed.ok) return parsed.response;

    if (scoreUserId.data === userId) {
      return err(c, "VALIDATION", "you can't react to your own score");
    }
    // Friend-graph gate — a non-friend 404s, indistinguishable from a missing
    // score, so reactions can't be used to probe a stranger.
    const friendIds = await friendsOf(userId);
    if (!friendIds.includes(scoreUserId.data)) {
      return err(c, "NOT_FOUND", "score not found");
    }

    const db = getDb();
    const [score] = await db
      .select({ userId: gameScores.userId })
      .from(gameScores)
      .where(
        and(
          eq(gameScores.gameId, gameId.data),
          eq(gameScores.userId, scoreUserId.data),
          eq(gameScores.periodKey, periodKey.data),
        ),
      )
      .limit(1);
    if (!score) return err(c, "NOT_FOUND", "score not found");

    const now = new Date();
    await db
      .insert(gameScoreReactions)
      .values({
        gameId: gameId.data,
        periodKey: periodKey.data,
        scoreUserId: scoreUserId.data,
        reactorUserId: userId,
        emoji: parsed.data.emoji,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          gameScoreReactions.gameId,
          gameScoreReactions.periodKey,
          gameScoreReactions.scoreUserId,
          gameScoreReactions.reactorUserId,
        ],
        set: { emoji: parsed.data.emoji, updatedAt: now },
      });

    const reactions = await reactionsForOneScore(
      userId,
      gameId.data,
      scoreUserId.data,
      periodKey.data,
    );
    const response: SetScoreReactionResponse = { reactions };
    return ok(c, response);
  },
);

/**
 * DELETE /v1/games/:id/reactions/:periodKey/:scoreUserId — clear the viewer's
 * reaction on a score. Only ever touches the caller's own row, so it needs no
 * friendship/score checks; a no-op when nothing was reacted.
 */
gameRoutes.delete("/:id/reactions/:periodKey/:scoreUserId", async (c) => {
  const userId = c.get("userId");
  const gameId = uuidSchema.safeParse(c.req.param("id"));
  if (!gameId.success) return err(c, "NOT_FOUND", "game not found");
  const scoreUserId = uuidSchema.safeParse(c.req.param("scoreUserId"));
  if (!scoreUserId.success) return err(c, "NOT_FOUND", "score not found");
  const periodKey = periodKeySchema.safeParse(c.req.param("periodKey"));
  if (!periodKey.success) return err(c, "VALIDATION", "invalid period");

  const db = getDb();
  await db
    .delete(gameScoreReactions)
    .where(
      and(
        eq(gameScoreReactions.gameId, gameId.data),
        eq(gameScoreReactions.periodKey, periodKey.data),
        eq(gameScoreReactions.scoreUserId, scoreUserId.data),
        eq(gameScoreReactions.reactorUserId, userId),
      ),
    );

  const reactions = await reactionsForOneScore(
    userId,
    gameId.data,
    scoreUserId.data,
    periodKey.data,
  );
  const response: SetScoreReactionResponse = { reactions };
  return ok(c, response);
});

/**
 * PUT /v1/games/:id/score-spec — the self-serve "teach us your game" flow.
 * The client tokenizes the user's share, the user taps their score, the
 * client synthesizes a ScoreSpec (`@workshop/shared/scoreParsing`) and sends
 * it here with the example it learned from — optionally alongside a
 * SummarySpec (`@workshop/shared/summarySpec`), the taught recap formatter
 * built from the lines the user kept in the recap preview. Two gates before
 * anything is stored:
 *
 * 1. Registry games are read-only — their specs live in code, so a user
 *    can't (accidentally or otherwise) re-teach Wordle.
 * 2. The spec must reproduce `expectedValue` on `exampleRaw`. A spec that
 *    can't parse its own teaching example is rejected outright.
 *
 * Specs live on the shared catalog row, so the first person to teach a game
 * fixes it for everyone — and anyone can re-teach (the same validation
 * applies; `score_raw` history makes a bad spec one rescore away from fixed).
 * The caller's own score for the example is re-posted by the client via the
 * normal upsert, so no rescore happens here.
 *
 * Because this is the one write surface where any signed-in user mutates a
 * GLOBAL row, every successful teach is audited (an append-only
 * `game_spec_revisions` row, written in the same transaction — who, when,
 * what spec, from which example) and pinged to #workshop-admin
 * (`notifyScoreSpecTaught`), so a poisoned config is attributable and
 * visible immediately. Revert = copy the prior revision's values back onto
 * `games`, then `scripts/rescore-game.ts`.
 */
gameRoutes.put(
  "/:id/score-spec",
  rateLimit({
    family: "v1.games.score-spec",
    limit: 20,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const gameId = uuidSchema.safeParse(c.req.param("id"));
    if (!gameId.success) return err(c, "NOT_FOUND", "game not found");

    const parsed = await parseJsonBody(c, setScoreSpecSchema);
    if (!parsed.ok) return parsed.response;

    const db = getDb();
    const [game] = await db.select().from(games).where(eq(games.id, gameId.data)).limit(1);
    if (!game) return err(c, "NOT_FOUND", "game not found");
    if (catalogEntryForKey(game.gameKey)) {
      return err(c, "VALIDATION", "this game's scoring is built in and can't be changed");
    }

    const reproduced = parseScoreWithSpec(parsed.data.spec, parsed.data.exampleRaw);
    if (reproduced !== parsed.data.expectedValue) {
      return err(c, "VALIDATION", "spec does not reproduce the expected score on the example");
    }

    // Same gate for the recap formatter: one that renders its own teaching
    // example to nothing would blank every recap row, so it's never stored.
    const summarySpec = parsed.data.summarySpec ?? null;
    if (summarySpec && evaluateSummarySpec(summarySpec, parsed.data.exampleRaw) === null) {
      return err(c, "VALIDATION", "summary spec produces nothing on the example");
    }

    const userId = c.get("userId");
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(games)
        .set({
          scoreSpec: parsed.data.spec,
          scoreDirection: parsed.data.scoreDirection,
          summarySpec,
        })
        .where(eq(games.id, game.id))
        .returning();
      if (!row) return undefined;
      await tx.insert(gameSpecRevisions).values({
        gameId: game.id,
        taughtBy: userId,
        scoreSpec: parsed.data.spec,
        scoreDirection: parsed.data.scoreDirection,
        summarySpec,
        exampleRaw: parsed.data.exampleRaw,
      });
      return row;
    });
    if (!updated) return err(c, "INTERNAL", "score spec update returned no row");

    await notifyScoreSpecTaught(userId, game.title, {
      replacedExisting: game.scoreSpec !== null,
      scoreDirection: parsed.data.scoreDirection,
      hasSummarySpec: summarySpec !== null,
    });

    const response: SetGameScoreSpecResponse = { game: toGameShape(updated) };
    return ok(c, response);
  },
);
