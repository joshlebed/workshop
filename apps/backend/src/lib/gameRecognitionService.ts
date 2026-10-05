// DB + config wiring around the pure recognizer (lib/gameRecognition.ts):
// who the candidates are for a user, where their examples come from, and the
// shadow-mode log that compares a prediction with the game the user picked.
//
// Everything here runs inside a time budget. The shadow log is awaited inside
// a score post (Lambda freezes un-awaited work), so each step is bounded on
// its own — DB statements by a server-side `statement_timeout`, Jev by the
// time left — and a final cap covers whatever those can't (a stalled socket).

import { CATALOG_GAME_DEFINITIONS } from "@workshop/shared/gameRegistry";
import { normalizeGameUrl } from "@workshop/shared/games";
import { eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { type DbGame, gameScores, games, userGames } from "../db/schema.js";
import { getConfig } from "./config.js";
import {
  catalogGameNamedBy,
  type ExampleLoader,
  MAX_EXAMPLES_PER_GAME,
  RECOGNITION_SURFACE_THRESHOLD,
  type RecognitionResult,
  type RecognitionTrace,
  recognizeGame,
} from "./gameRecognition.js";
import { isGamesBetaUser } from "./gamesBeta.js";
import { jevRecognitionJudge } from "./jev.js";
import { logger } from "./logger.js";
import { type DbClient, executeRows } from "./sql.js";

/**
 * The recognition mode in force for one user: `on` for Games beta accounts,
 * otherwise whatever `GAME_RECOGNITION` says. Every gate goes through this,
 * so a user outside the beta gets exactly the global flag's behaviour.
 */
export function recognitionModeFor(userId: string): "off" | "shadow" | "on" {
  return isGamesBetaUser(userId) ? "on" : getConfig().gameRecognition;
}

interface RecognitionCandidateRow {
  game: DbGame;
  inMyGames: boolean;
}

// Stored scores read per game to end up with MAX_EXAMPLES_PER_GAME usable,
// distinct ones (friends post identical texts; some rows are hand-typed junk).
const STORED_SCORES_PER_GAME = MAX_EXAMPLES_PER_GAME * 3;

/**
 * What the shadow log may add to a score post, in total. Jev answers in
 * ~120ms p50 / ~200ms p95 and is asked on ~0.5% of posts; the DB steps are
 * single-digit ms. 400ms lets ~95% of Jev calls finish and bounds the rest.
 */
export const SHADOW_BUDGET_MS = 400;
/** The paste-sheet endpoint: a person is waiting, but not for long. */
const ENDPOINT_BUDGET_MS = 2500;
/** Server-side ceiling on each recognition DB step (`statement_timeout`). */
const DB_STEP_TIMEOUT_MS = 150;
/** Not worth starting a Jev call with less than this left. */
const MIN_JUDGE_MS = 50;
/** Room for the bounded steps to report their own timeout before the cap does. */
const SHADOW_CAP_SLACK_MS = 50;

const URL_IN_TEXT = /(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s?#]*)?/gi;
const MAX_URL_KEYS = 64;
const MAX_PATH_DEPTH = 6;

/**
 * Every `games.normalized_url` a link in the text could belong to: the host,
 * its parent domains (`www.maptap.gg` → `maptap.gg`), and each of those with
 * each leading run of path segments (`nytimes.com/games`,
 * `nytimes.com/games/wordle`). Exact strings, so the catalog lookup is an
 * equality probe on the `normalized_url` unique index.
 */
export function gameUrlKeysIn(text: string): string[] {
  const keys = new Set<string>();
  for (const link of text.match(URL_IN_TEXT) ?? []) {
    const [rawHost = "", ...segments] = link.split("/");
    const labels = rawHost.toLowerCase().split(".");
    const paths = [""];
    for (const segment of segments.slice(0, MAX_PATH_DEPTH)) {
      // "…/play!" and "…/mini." end a sentence, not a path.
      const clean = segment.replace(/[^A-Za-z0-9_-]+$/, "");
      if (!clean) break;
      const parent = paths[paths.length - 1] as string;
      paths.push(`${parent}/${clean}`);
      if (clean !== segment) break;
    }
    for (let i = 0; i + 2 <= labels.length; i++) {
      const host = labels.slice(i).join(".");
      for (const path of paths) {
        keys.add(host + path);
        // `normalized_url` keeps the path's case; a share may not.
        keys.add(host + path.toLowerCase());
      }
    }
    if (keys.size >= MAX_URL_KEYS) break;
  }
  return [...keys].slice(0, MAX_URL_KEYS);
}

// Registry games as recognition candidates, keyed the way `games` stores them.
const REGISTRY_CANDIDATES = CATALOG_GAME_DEFINITIONS.flatMap((def) => {
  const normalizedUrl = normalizeGameUrl(def.canonicalUrl);
  return normalizedUrl ? [{ id: def.key, title: def.title, normalizedUrl }] : [];
});

/**
 * The games a paste by this user could be for: their My Games, plus catalog
 * games they haven't added that the text itself names (so a share from a game
 * outside their list is still recognized, as the registry regexes do today).
 * See `catalogGameNamedBy` for what "names" means.
 *
 * Two index probes, neither of which grows with the catalog: My Games by
 * `user_games (user_id, …)`, and the catalog by exact `normalized_url` — the
 * URLs the text links, plus those of the registry games it names (decided
 * here from the registry, so the query never has to look at titles).
 */
async function loadRecognitionCandidates(
  userId: string,
  text: string,
  options: { includeGameIds?: string[] },
  db: DbClient,
): Promise<RecognitionCandidateRow[]> {
  const mine = await db
    .select({ game: games })
    .from(userGames)
    .innerJoin(games, eq(games.id, userGames.gameId))
    .where(eq(userGames.userId, userId));
  const candidates = new Map<string, RecognitionCandidateRow>(
    mine.map((row) => [row.game.id, { game: row.game, inMyGames: true }]),
  );

  const urlKeys = new Set(gameUrlKeysIn(text));
  for (const def of REGISTRY_CANDIDATES) {
    if (catalogGameNamedBy(text, def, true)) urlKeys.add(def.normalizedUrl);
  }
  const include = (options.includeGameIds ?? []).filter((id) => !candidates.has(id));
  if (urlKeys.size > 0 || include.length > 0) {
    const named = await db
      .select()
      .from(games)
      .where(
        or(
          urlKeys.size > 0 ? inArray(games.normalizedUrl, [...urlKeys]) : undefined,
          include.length > 0 ? inArray(games.id, include) : undefined,
        ),
      );
    for (const game of named) {
      if (candidates.has(game.id)) continue;
      if (include.includes(game.id) || catalogGameNamedBy(text, game, game.gameKey !== null)) {
        candidates.set(game.id, { game, inMyGames: false });
      }
    }
  }
  return [...candidates.values()];
}

/**
 * Loads each game's most recent stored scores, any player's — every posted
 * score is a labelled example of its game. "Recent" is by puzzle day
 * (`period_key`, an ISO date), which is what the existing
 * `(game_id, period_key)` index is ordered by: each game costs one bounded
 * backward index scan no matter how many scores it has. `exclude` keeps one
 * user's score for one day out, so a prediction about a score that was just
 * saved isn't made by looking at that same score.
 */
function storedScoreLoader(
  db: DbClient,
  exclude?: { userId: string; periodKey: string },
): ExampleLoader {
  return async (gameIds) => {
    const byGame = new Map<string, string[]>();
    if (gameIds.length === 0) return byGame;
    const ids = sql.join(
      gameIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const notExcluded = exclude
      ? sql`and (s.user_id <> ${exclude.userId} or s.period_key <> ${exclude.periodKey})`
      : sql``;
    const rows = await executeRows<{ game_id: string; score_raw: string }>(
      db,
      sql`
        select g.id as game_id, recent.score_raw
        from unnest(array[${ids}]) as g(id)
        cross join lateral (
          select s.score_raw, s.period_key
          from ${gameScores} as s
          where s.game_id = g.id ${notExcluded}
          order by s.period_key desc
          limit ${STORED_SCORES_PER_GAME}
        ) as recent
        order by g.id, recent.period_key desc
      `,
    );
    for (const row of rows) {
      const list = byGame.get(row.game_id);
      if (list) list.push(row.score_raw);
      else byGame.set(row.game_id, [row.score_raw]);
    }
    return byGame;
  };
}

/**
 * Run one recognition DB step under a server-side `statement_timeout`, so a
 * slow or stuck query is cancelled by Postgres and its promise settles —
 * rather than being abandoned, still holding this container's only connection.
 */
async function boundedDbStep<T>(
  db: DbClient,
  timeoutMs: number,
  step: (db: DbClient) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const ms = Math.max(1, Math.floor(timeoutMs));
    await tx.execute(sql.raw(`set local statement_timeout = ${ms}`));
    return step(tx);
  });
}

interface UserRecognition {
  result: RecognitionResult | null;
  match: RecognitionCandidateRow | null;
  candidates: RecognitionCandidateRow[];
  trace: RecognitionTrace;
}

/**
 * Run the whole pipeline for one user's paste within `budgetMs`. Never
 * throws: anything that fails or runs out of time is "no detection".
 */
export async function recognizeGameForUser(
  userId: string,
  text: string,
  options: {
    budgetMs?: number;
    includeGameIds?: string[];
    excludeScore?: { userId: string; periodKey: string };
  } = {},
  db: DbClient = getDb(),
): Promise<UserRecognition> {
  const trace: RecognitionTrace = {};
  const deadline = Date.now() + (options.budgetMs ?? ENDPOINT_BUDGET_MS);
  const remaining = () => deadline - Date.now();
  const dbStepMs = () => Math.min(DB_STEP_TIMEOUT_MS, remaining());
  try {
    const candidates = await boundedDbStep(db, dbStepMs(), (tx) =>
      loadRecognitionCandidates(userId, text, options, tx),
    );
    const result = await recognizeGame(
      text,
      candidates.map((c) => ({
        id: c.game.id,
        title: c.game.title,
        normalizedUrl: c.game.normalizedUrl,
      })),
      {
        trace,
        loadExamples: (gameIds) =>
          boundedDbStep(db, dbStepMs(), (tx) =>
            storedScoreLoader(tx, options.excludeScore)(gameIds),
          ),
        judge: getConfig().typesafeApiKey
          ? async (request) => {
              const timeoutMs = remaining();
              if (timeoutMs < MIN_JUDGE_MS) return null;
              return jevRecognitionJudge(request, { timeoutMs });
            }
          : undefined,
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
 * already committed, and nothing here can change or fail it, or hold its
 * response for more than `SHADOW_BUDGET_MS` (plus a few ms of slack). One
 * `kind: "game_recognition_shadow"` line per post; the raw text stays in
 * `game_scores` (join on user_id + game_id + period_key), not in the logs.
 */
export async function shadowRecognizePostedScore(input: {
  userId: string;
  gameId: string;
  periodKey: string;
  scoreRaw: string;
}): Promise<void> {
  if (recognitionModeFor(input.userId) === "off") return;
  const startedAt = Date.now();
  const base = {
    kind: "game_recognition_shadow",
    user_id: input.userId,
    period_key: input.periodKey,
    actual_game_id: input.gameId,
    raw_length: input.scoreRaw.length,
  };

  // Every step above is bounded on its own, so this cap should never be what
  // ends the wait. It is here for what a statement timeout can't reach — a
  // connection that has stopped answering.
  let capTimer: ReturnType<typeof setTimeout> | undefined;
  const capped = new Promise<null>((resolve) => {
    capTimer = setTimeout(() => resolve(null), SHADOW_BUDGET_MS + SHADOW_CAP_SLACK_MS);
  });
  const recognition = await Promise.race([
    recognizeGameForUser(input.userId, input.scoreRaw, {
      budgetMs: SHADOW_BUDGET_MS,
      includeGameIds: [input.gameId],
      excludeScore: { userId: input.userId, periodKey: input.periodKey },
    }),
    capped,
  ]);
  clearTimeout(capTimer);
  if (!recognition) {
    logger.warn("game recognition shadow", {
      ...base,
      outcome: "capped",
      duration_ms: Date.now() - startedAt,
    });
    return;
  }

  const { result, candidates, trace } = recognition;
  const surfaced = result !== null && result.confidence >= RECOGNITION_SURFACE_THRESHOLD;
  logger.info("game recognition shadow", {
    ...base,
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
    duration_ms: Date.now() - startedAt,
  });
}
