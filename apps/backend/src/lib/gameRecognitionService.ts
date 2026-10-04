// DB + config wiring around the pure recognizer (lib/gameRecognition.ts):
// who the candidates are for a user, where their examples come from, and the
// shadow-mode log that compares a prediction with the game the user picked.

import { and, eq, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { type DbGame, gameScores, games, userGames } from "../db/schema.js";
import { getConfig } from "./config.js";
import {
  catalogGameNamedBy,
  type ExampleLoader,
  hostsIn,
  MAX_EXAMPLES_PER_GAME,
  RECOGNITION_SURFACE_THRESHOLD,
  type RecognitionResult,
  type RecognitionTrace,
  recognizeGame,
} from "./gameRecognition.js";
import { jevRecognitionJudge } from "./jev.js";
import { logger } from "./logger.js";
import type { DbClient } from "./sql.js";

interface RecognitionCandidateRow {
  game: DbGame;
  inMyGames: boolean;
}

// Stored scores read per game to end up with MAX_EXAMPLES_PER_GAME usable,
// distinct ones (friends post identical texts; some rows are hand-typed junk).
const STORED_SCORES_PER_GAME = MAX_EXAMPLES_PER_GAME * 3;
const MAX_HOSTS_IN_TEXT = 8;

/**
 * Every host-like token in the text plus its parent domains, so a share that
 * links `www.maptap.gg` or `play.example.com` finds a game stored as
 * `maptap.gg` / `example.com`.
 */
function hostsInText(text: string): string[] {
  const hosts = new Set<string>();
  for (const host of hostsIn(text)) {
    const labels = host.split(".");
    for (let i = 0; i + 2 <= labels.length; i++) hosts.add(labels.slice(i).join("."));
    if (hosts.size >= MAX_HOSTS_IN_TEXT) break;
  }
  return [...hosts].slice(0, MAX_HOSTS_IN_TEXT);
}

/**
 * The games a paste by this user could be for: their My Games, plus catalog
 * games they haven't added that the text itself names (so a share from a game
 * outside their list is still recognized, as the registry regexes do today).
 * See `catalogGameNamedBy` for what "names" means. My Games is bounded by the
 * user's list; the catalog side is a host equality lookup plus the handful of
 * registry rows — neither grows with the catalog.
 */
async function loadRecognitionCandidates(
  userId: string,
  text: string,
  options: { includeGameIds?: string[] } = {},
  db: DbClient = getDb(),
): Promise<RecognitionCandidateRow[]> {
  const hosts = hostsInText(text);
  const include = options.includeGameIds ?? [];
  const rows = await db
    .select({ game: games, memberOf: userGames.userId })
    .from(games)
    .leftJoin(userGames, and(eq(userGames.gameId, games.id), eq(userGames.userId, userId)))
    .where(
      or(
        isNotNull(userGames.userId),
        isNotNull(games.gameKey),
        hosts.length > 0
          ? inArray(sql`split_part(${games.normalizedUrl}, '/', 1)`, hosts)
          : undefined,
        include.length > 0 ? inArray(games.id, include) : undefined,
      ),
    );
  return rows
    .map((row) => ({ game: row.game, inMyGames: row.memberOf !== null }))
    .filter(
      (c) =>
        c.inMyGames ||
        include.includes(c.game.id) ||
        catalogGameNamedBy(text, c.game, c.game.gameKey !== null),
    );
}

/**
 * Loads each game's most recent stored scores, any player's — every posted
 * score is a labelled example of its game. `exclude` keeps one user's score
 * for one day out, so a prediction about a score that was just saved isn't
 * made by looking at that same score.
 */
function storedScoreLoader(
  exclude?: { userId: string; periodKey: string },
  db: DbClient = getDb(),
): ExampleLoader {
  return async (gameIds) => {
    const byGame = new Map<string, string[]>();
    if (gameIds.length === 0) return byGame;
    const ranked = db
      .select({
        gameId: gameScores.gameId,
        scoreRaw: gameScores.scoreRaw,
        recency:
          sql<number>`row_number() over (partition by ${gameScores.gameId} order by ${gameScores.createdAt} desc)`.as(
            "recency",
          ),
      })
      .from(gameScores)
      .where(
        and(
          inArray(gameScores.gameId, gameIds),
          exclude
            ? or(ne(gameScores.userId, exclude.userId), ne(gameScores.periodKey, exclude.periodKey))
            : undefined,
        ),
      )
      .as("ranked");
    const rows = await db
      .select({ gameId: ranked.gameId, scoreRaw: ranked.scoreRaw })
      .from(ranked)
      .where(lte(ranked.recency, STORED_SCORES_PER_GAME))
      .orderBy(ranked.gameId, ranked.recency);
    for (const row of rows) {
      const list = byGame.get(row.gameId);
      if (list) list.push(row.scoreRaw);
      else byGame.set(row.gameId, [row.scoreRaw]);
    }
    return byGame;
  };
}

interface UserRecognition {
  result: RecognitionResult | null;
  match: RecognitionCandidateRow | null;
  candidates: RecognitionCandidateRow[];
  trace: RecognitionTrace;
}

/** Run the whole pipeline for one user's paste. Never throws. */
export async function recognizeGameForUser(
  userId: string,
  text: string,
  options: {
    includeGameIds?: string[];
    excludeScore?: { userId: string; periodKey: string };
  } = {},
  db: DbClient = getDb(),
): Promise<UserRecognition> {
  const trace: RecognitionTrace = {};
  try {
    const candidates = await loadRecognitionCandidates(userId, text, options, db);
    const result = await recognizeGame(
      text,
      candidates.map((c) => ({
        id: c.game.id,
        title: c.game.title,
        normalizedUrl: c.game.normalizedUrl,
      })),
      {
        trace,
        loadExamples: storedScoreLoader(options.excludeScore, db),
        judge: getConfig().typesafeApiKey ? jevRecognitionJudge : undefined,
      },
    );
    const match = result ? (candidates.find((c) => c.game.id === result.gameId) ?? null) : null;
    return { result, match, candidates, trace };
  } catch (error) {
    logger.warn("game recognition failed", { error });
    return { result: null, match: null, candidates: [], trace };
  }
}

/**
 * Shadow mode: recognize a score that was just posted and log the prediction
 * next to the game the user actually chose. Observes only — the post has
 * already committed, and nothing here can change or fail it. One
 * `kind: "game_recognition_shadow"` line per post; the raw text stays in
 * `game_scores` (join on user_id + game_id + period_key), not in the logs.
 */
export async function shadowRecognizePostedScore(input: {
  userId: string;
  gameId: string;
  periodKey: string;
  scoreRaw: string;
}): Promise<void> {
  if (getConfig().gameRecognition === "off") return;
  const startedAt = Date.now();
  const { result, candidates, trace } = await recognizeGameForUser(input.userId, input.scoreRaw, {
    includeGameIds: [input.gameId],
    excludeScore: { userId: input.userId, periodKey: input.periodKey },
  });
  const surfaced = result !== null && result.confidence >= RECOGNITION_SURFACE_THRESHOLD;
  logger.info("game recognition shadow", {
    kind: "game_recognition_shadow",
    user_id: input.userId,
    period_key: input.periodKey,
    actual_game_id: input.gameId,
    predicted_game_id: result?.gameId ?? null,
    method: result?.method ?? null,
    confidence: result?.confidence ?? null,
    // What the user would have seen: a prompt for the right game, a prompt
    // for the wrong one, or nothing.
    outcome: !surfaced ? "none" : result.gameId === input.gameId ? "agree" : "disagree",
    best_guess: trace.bestGuess ?? null,
    candidates: candidates.length,
    cheap_hits: trace.cheapHits?.length ?? 0,
    judge_called: trace.judgeCalled ?? false,
    judge_failed: trace.judgeFailed ?? false,
    raw_length: input.scoreRaw.length,
    duration_ms: Date.now() - startedAt,
  });
}
