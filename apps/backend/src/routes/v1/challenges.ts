// Challenge links (`/c/:token`, onboarding spike #2) — "I got 937 on today's
// MapTap. Beat me". See `lib/challenges.ts` for the model.
//
//   POST /v1/games/:id/challenges   mint/reuse mine for (game, day) — registered
//                                   on `gameRoutes` (blanket requireAuth) via
//                                   `registerChallengeMintRoute`
//   GET  /v1/challenges/:token      optional-auth resolve (OG card + landing)
//   POST /v1/challenges/:token/accept  friendship + game + `challenge_accepts`
//
// `/v1/challenges` is its own mount (like `/v1/game-share`) so the resolve can
// serve link crawlers without a session. Same games flag gate (404 when off).
//
// Funnel log lines (CloudWatch, `msg` is the event): `challenge minted`,
// `challenge resolved` (`src`: card | landing | other; `viewer`: anonymous |
// self | friend | stranger), `challenge accepted`. "Posted a score inside the
// day" is derived: `challenge_accepts` ⋈ `game_challenges` ⋈ `game_scores` on
// (accepter, game, period) — see apps/backend/CLAUDE.md for the query.

import type {
  AcceptGameChallengeResponse,
  ExpiredGameChallengeDetails,
  GameChallengePreview,
  GameChallengeResponse,
} from "@workshop/shared/games";
import { and, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { withDbRetry } from "../../db/retry.js";
import { challengeAccepts, gameScores, games, userGames, users } from "../../db/schema.js";
import { blockedEitherWay } from "../../lib/blocks.js";
import {
  challengeScore,
  challengeUrl,
  findOrCreateChallenge,
  resolveChallenge,
} from "../../lib/challenges.js";
import { callerIpKey } from "../../lib/clientIp.js";
import { getConfig } from "../../lib/config.js";
import { toIsoString } from "../../lib/dates.js";
import { addFriendship, deletePendingBetween, friendsOf } from "../../lib/friends.js";
import { normalizeScoreDirection } from "../../lib/gameCatalog.js";
import { gameScoreUnit, gameShapeColumns, toGameShape } from "../../lib/gameShapes.js";
import { logger } from "../../lib/logger.js";
import { isNudgeablePeriod } from "../../lib/nudges.js";
import { parseJsonBody } from "../../lib/request.js";
import { requestOriginColumns } from "../../lib/requestContext.js";
import { err, ok } from "../../lib/response.js";
import { isValidShareSlug } from "../../lib/shareSlug.js";
import { addToMyGames } from "../../lib/userGames.js";
import { optionalAuth, requireAuth } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { workshopGamesSunset } from "../../middleware/workshop-games-sunset.js";

const uuidSchema = z.string().uuid();
const mintSchema = z.object({
  periodKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "periodKey must be YYYY-MM-DD"),
});

const challengeGameColumns = {
  id: games.id,
  title: games.title,
  url: games.url,
  iconUrl: games.iconUrl,
  scoreDirection: games.scoreDirection,
  scoreUnit: games.scoreUnit,
  gameKey: games.gameKey,
};

type ChallengeGameRow = {
  id: string;
  title: string;
  url: string;
  iconUrl: string | null;
  scoreDirection: string;
  scoreUnit: string | null;
  gameKey: string | null;
};

function publicGame(row: ChallengeGameRow): GameChallengePreview["game"] {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    iconUrl: row.iconUrl,
    scoreDirection: normalizeScoreDirection(row.scoreDirection),
    scoreUnit: gameScoreUnit(row),
  };
}

/** Which surface asked: the Pages OG function, the in-app landing, or other. */
function resolveSource(c: Context): "card" | "landing" | "other" {
  const src = c.req.query("src");
  return src === "card" || src === "landing" ? src : "other";
}

// --- POST /v1/games/:id/challenges — mint/reuse mine for one day ---

type GameRoutes = Hono;

export function registerChallengeMintRoute(gameRoutes: GameRoutes): void {
  gameRoutes.post(
    "/:id/challenges",
    rateLimit({
      family: "v1.challenges.mint",
      limit: 60,
      windowSec: 3600,
      key: (c) => c.get("userId") ?? null,
    }),
    async (c) => {
      const userId: string = c.get("userId");
      const gameId = uuidSchema.safeParse(c.req.param("id"));
      if (!gameId.success) return err(c, "NOT_FOUND", "game not found");
      const parsed = await parseJsonBody(c, mintSchema);
      if (!parsed.ok) return parsed.response;
      const { periodKey } = parsed.data;
      // A challenge is for a puzzle someone can still play: today, in any
      // timezone (period keys are the client's local date).
      if (!isNudgeablePeriod(periodKey)) {
        return err(c, "VALIDATION", "you can only challenge today's game");
      }

      const [row] = await getDb()
        .select({
          scoreValue: gameScores.scoreValue,
          scoreSummary: gameScores.scoreSummary,
          game: challengeGameColumns,
        })
        .from(gameScores)
        .innerJoin(games, eq(games.id, gameScores.gameId))
        .where(
          and(
            eq(gameScores.gameId, gameId.data),
            eq(gameScores.userId, userId),
            eq(gameScores.periodKey, periodKey),
          ),
        )
        .limit(1);
      if (!row) {
        return err(c, "CONFLICT", "post your score first", { code: "NO_SCORE" });
      }

      const minted = await findOrCreateChallenge({
        challengerId: userId,
        gameId: gameId.data,
        periodKey,
        scoreValue: row.scoreValue,
        scoreSummary: row.scoreSummary,
      });
      logger.info("challenge minted", {
        challengeId: minted.id,
        challengerId: userId,
        gameId: gameId.data,
        periodKey,
        reused: minted.reused,
      });

      const response: GameChallengeResponse = {
        token: minted.token,
        url: challengeUrl(minted.token),
        gameTitle: row.game.title,
        periodKey,
        expiresAt: toIsoString(minted.expiresAt),
        score: challengeScore(row.scoreValue, row.scoreSummary, gameScoreUnit(row.game)),
      };
      return ok(c, response, 201);
    },
  );
}

export const challengeRoutes = new Hono();

challengeRoutes.use("*", async (c, next) => {
  const config = getConfig();
  if (!config.isLocal && !config.gamesEnabled) return err(c, "NOT_FOUND", "not found");
  await next();
});
challengeRoutes.use("*", workshopGamesSunset());

/** The challenge plus its game and challenger, or null for an unknown token. */
async function loadChallenge(token: string) {
  if (!isValidShareSlug(token)) return null;
  const challenge = await withDbRetry(() => resolveChallenge(token));
  if (!challenge) return null;
  const db = getDb();
  const [[game], [challenger]] = await Promise.all([
    db.select(challengeGameColumns).from(games).where(eq(games.id, challenge.gameId)).limit(1),
    db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, challenge.challengerId))
      .limit(1),
  ]);
  if (!game || !challenger) return null;
  return { challenge, game, challenger };
}

// --- GET /v1/challenges/:token — resolve ---
// Public part: challenger, game, score to beat, expiry (the challenger chose
// to share all of it). A signed-in viewer also gets `viewer`; a block in
// either direction reads as "no such challenge".

challengeRoutes.get(
  "/:token",
  optionalAuth,
  rateLimit({ family: "v1.challenges.resolve", limit: 60, windowSec: 60, key: callerIpKey }),
  async (c) => {
    const loaded = await loadChallenge(c.req.param("token"));
    if (!loaded) return err(c, "NOT_FOUND", "challenge not found");
    const { challenge, game, challenger } = loaded;
    const unit = gameScoreUnit(game);
    const expired = Date.now() > challenge.expiresAt.getTime();

    const viewerId: string | undefined = c.get("userId");
    let viewer: GameChallengePreview["viewer"];
    if (viewerId) {
      if (await blockedEitherWay(viewerId, challenger.id)) {
        return err(c, "NOT_FOUND", "challenge not found");
      }
      const db = getDb();
      const isSelf = viewerId === challenger.id;
      const [friends, [owned], [accepted], [score]] = await Promise.all([
        isSelf ? Promise.resolve<string[]>([]) : friendsOf(viewerId),
        db
          .select({ gameId: userGames.gameId })
          .from(userGames)
          .where(and(eq(userGames.userId, viewerId), eq(userGames.gameId, game.id)))
          .limit(1),
        db
          .select({ userId: challengeAccepts.userId })
          .from(challengeAccepts)
          .where(
            and(
              eq(challengeAccepts.challengeId, challenge.id),
              eq(challengeAccepts.userId, viewerId),
            ),
          )
          .limit(1),
        db
          .select({ value: gameScores.scoreValue, summary: gameScores.scoreSummary })
          .from(gameScores)
          .where(
            and(
              eq(gameScores.gameId, game.id),
              eq(gameScores.userId, viewerId),
              eq(gameScores.periodKey, challenge.periodKey),
            ),
          )
          .limit(1),
      ]);
      viewer = {
        isSelf,
        isFriend: friends.includes(challenger.id),
        hasGame: Boolean(owned),
        accepted: Boolean(accepted),
        score: score ? challengeScore(score.value, score.summary, unit) : null,
      };
    }

    logger.info("challenge resolved", {
      challengeId: challenge.id,
      src: resolveSource(c),
      viewer: !viewer
        ? "anonymous"
        : viewer.isSelf
          ? "self"
          : viewer.isFriend
            ? "friend"
            : "stranger",
      viewerId: viewerId ?? null,
      expired,
    });

    const response: GameChallengePreview = {
      token: challenge.token,
      challenger: { userId: challenger.id, displayName: challenger.displayName },
      game: publicGame(game),
      periodKey: challenge.periodKey,
      score: challengeScore(challenge.scoreValue, challenge.scoreSummary, unit),
      expiresAt: toIsoString(challenge.expiresAt),
      expired,
      ...(viewer ? { viewer } : {}),
    };
    return ok(c, response);
  },
);

// --- POST /v1/challenges/:token/accept ---
// Forms the friendship (holding the token is the vouch), adds the game, and
// records the accept. Idempotent. An expired challenge answers 410 with the
// game so the client can offer "add it anyway" (`POST /v1/games`).

challengeRoutes.post(
  "/:token/accept",
  requireAuth,
  rateLimit({
    family: "v1.challenges.accept",
    limit: 30,
    windowSec: 3600,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const userId: string = c.get("userId");
    const loaded = await loadChallenge(c.req.param("token"));
    if (!loaded) return err(c, "NOT_FOUND", "challenge not found");
    const { challenge, game, challenger } = loaded;
    if (challenger.id === userId) {
      return err(c, "VALIDATION", "you can't accept your own challenge");
    }
    if (await blockedEitherWay(userId, challenger.id)) {
      return err(c, "NOT_FOUND", "challenge not found");
    }
    if (Date.now() > challenge.expiresAt.getTime()) {
      const details: ExpiredGameChallengeDetails = {
        code: "CHALLENGE_EXPIRED",
        game: publicGame(game),
        challenger: { userId: challenger.id, displayName: challenger.displayName },
      };
      logger.info("challenge accept expired", { challengeId: challenge.id, accepterId: userId });
      return err(c, "GONE", "today's challenge is over", details);
    }

    const friendshipCreated = await addFriendship(userId, challenger.id);
    await deletePendingBetween(userId, challenger.id);
    const db = getDb();
    // Appended at the end of My Games; an existing row keeps its place.
    const membership = await addToMyGames(userId, game.id);
    const inserted = await db
      .insert(challengeAccepts)
      .values({
        challengeId: challenge.id,
        userId,
        friendshipCreated,
        gameAdded: membership.created,
        ...requestOriginColumns(),
      })
      .onConflictDoNothing()
      .returning({ userId: challengeAccepts.userId });
    const [shape] = await db.select(gameShapeColumns).from(games).where(eq(games.id, game.id));
    if (!shape) return err(c, "INTERNAL", "game lookup failed");

    logger.info("challenge accepted", {
      challengeId: challenge.id,
      challengerId: challenger.id,
      accepterId: userId,
      gameId: game.id,
      periodKey: challenge.periodKey,
      friendshipCreated,
      gameAdded: membership.created,
      firstAccept: inserted.length > 0,
    });

    const response: AcceptGameChallengeResponse = {
      friend: { userId: challenger.id, displayName: challenger.displayName },
      game: toGameShape(shape),
      periodKey: challenge.periodKey,
      friendshipCreated,
      gameAdded: membership.created,
    };
    return ok(c, response, 201);
  },
);
