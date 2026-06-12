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
  SetGameScoreSpecResponse,
  UpsertGameScoreResponse,
} from "@workshop/shared/games";
import { normalizeGameUrl } from "@workshop/shared/games";
import { parseScoreWithSpec, scoreSpecSchema } from "@workshop/shared/scoreParsing";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { gameScores, games, userGames, users } from "../../db/schema.js";
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
});

const moveGameSchema = z.object({
  beforeGameId: z.union([z.string().uuid(), z.null()]).optional(),
  afterGameId: z.union([z.string().uuid(), z.null()]).optional(),
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

async function loadStandingsByGame(
  viewerId: string,
  gameIds: string[],
  periodKey: string,
): Promise<Map<string, GameStandingsEntry[]>> {
  const byGame = new Map<string, GameStandingsEntry[]>();
  if (gameIds.length === 0) return byGame;
  const db = getDb();
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
        inArray(gameScores.userId, await visibleUserIds(viewerId)),
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
    });
    byGame.set(r.gameId, entries);
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

  const standingsByGame = await loadStandingsByGame(
    userId,
    rows.map((r) => r.game.id),
    periodKey,
  );

  const myGames: MyGame[] = rows.map((r) => {
    const entries = rankEntries(
      standingsByGame.get(r.game.id) ?? [],
      normalizeScoreDirection(r.game.scoreDirection),
    );
    const standings: GameStandings = {
      periodKey,
      entries,
      viewerHasPlayed: entries.some((e) => e.userId === userId),
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
 * keeps owned games in the ranked list (tagged `inMyGames`) so the + add-game
 * sheet can show the *full* picture of what my friends play, not just the
 * addable remainder — the common case (you already play everything your friends
 * do) otherwise renders an empty suggestions section. `?friend=<userId>` narrows
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
  // Most-played-among-friends first; stable tiebreak on title.
  const discovered = [...byGame.values()].sort(
    (a, b) => b.friends.length - a.friends.length || a.game.title.localeCompare(b.game.title),
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

/**
 * PUT /v1/games/:id/score-spec — the self-serve "teach us your game" flow.
 * The client tokenizes the user's share, the user taps their score, the
 * client synthesizes a ScoreSpec (`@workshop/shared/scoreParsing`) and sends
 * it here with the example it learned from. Two gates before anything is
 * stored:
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

    const [updated] = await db
      .update(games)
      .set({ scoreSpec: parsed.data.spec, scoreDirection: parsed.data.scoreDirection })
      .where(eq(games.id, game.id))
      .returning();
    if (!updated) return err(c, "INTERNAL", "score spec update returned no row");

    const response: SetGameScoreSpecResponse = { game: toGameShape(updated) };
    return ok(c, response);
  },
);
