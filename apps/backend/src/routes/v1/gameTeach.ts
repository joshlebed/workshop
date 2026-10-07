// Teach v2 routes (spec: docs/highscore-score-validation-spec.md), registered
// onto the Games router so they share its flag gate and auth:
//
//   POST /v1/games/score-preview              share flow: text, no game yet
//   POST /v1/games/:id/scores/preview         dry-run a post (extends the code-parsing preview)
//   POST /v1/games/:id/scores/candidates      role labels for the picker (LLM step 1)
//   PUT  /v1/games/:id/scores                 the score post, with an optional pick
//   POST /v1/games/:id/scores/:periodKey/pick "Fix score" on the caller's own row
//   POST /v1/games/:id/parser/teach           teach the parser from that pick (LLM step 2)
//   PUT  /v1/games/:id/score-direction        the "…" menu's direction change
//   POST /v1/games/:id/parser/rollback        operator: restore a prior version
//
// All of it 404s unless teach is on for the caller (`teachModeFor`): the three
// Games beta accounts, or everyone once `GAME_TEACH=on`. The model is only
// called by `candidates` and `parser/teach` — never by a preview or a post.

import type {
  ApplyScorePickResponse,
  PreviewGameScoreResponse,
  ScoreCandidatesResponse,
  ScoreInputRejectedDetails,
  ScoreInputRejection,
  SetScoreDirectionResponse,
  SharePreviewResponse,
  TeachParserResponse,
  UpsertGameScoreResponse,
} from "@workshop/shared/games";
import { computeScoreFeatures, SCORE_FEATURE_ROLES } from "@workshop/shared/scoreCandidates";
import { eq } from "drizzle-orm";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { type DbGame, games, users } from "../../db/schema.js";
import { isAdminUser } from "../../lib/admin.js";
import {
  containsObjectionableContent,
  OBJECTIONABLE_CONTENT_MESSAGE,
} from "../../lib/contentFilter.js";
import { RECOGNITION_SURFACE_THRESHOLD } from "../../lib/gameRecognition.js";
import {
  recognitionModeFor,
  recognizeGameForUser,
  shadowRecognizePostedScore,
} from "../../lib/gameRecognitionService.js";
import { todayPeriodKey, toGameShape } from "../../lib/gameShapes.js";
import { logger } from "../../lib/logger.js";
import {
  notifyFirstScore,
  opsNotificationsEnabled,
  userHasAnyScore,
} from "../../lib/opsNotifications.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { claimTeachLlmCall } from "../../lib/teach/budget.js";
import { requestDirection } from "../../lib/teach/direction.js";
import { FIND_TARGETS_TIMEOUT_MS, findTargets } from "../../lib/teach/findTargets.js";
import { teachModeFor } from "../../lib/teach/gate.js";
import { checkScoreInput } from "../../lib/teach/inputGate.js";
import { logTeachEvent, type TeachLogContext } from "../../lib/teach/log.js";
import {
  applyPick,
  InvalidPickError,
  knownSymbolsFor,
  previewScore,
  saveScore,
  toScoreShape,
} from "../../lib/teach/scores.js";
import { rollbackParser, teachFromPick } from "../../lib/teach/teach.js";
import { addToMyGames } from "../../lib/userGames.js";
import { rateLimit } from "../../middleware/rate-limit.js";

const uuidSchema = z.string().uuid();
// Games puzzle days are calendar dates. (The older `periodKeySchema` is looser
// because the retired Lists leaderboards used other period shapes.)
const dayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "periodKey must be YYYY-MM-DD");
// Deliberately looser than the 2,000-char limit: the edge-input gate applies
// that limit itself, so an over-long paste is rejected with a reason and logged.
const rawSchema = z.string().max(20_000);
const pickSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("feature"), featureId: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("no_result") }),
]);
const roleSchema = z.enum(SCORE_FEATURE_ROLES);
const directionSchema = z.enum(["asc", "desc"]);

const previewSchema = z.object({
  scoreRaw: rawSchema,
  periodKey: dayKeySchema.optional(),
  entry: z.enum(["paste", "share", "fix"]).optional(),
});
const sharePreviewSchema = z.object({ scoreRaw: rawSchema, periodKey: dayKeySchema });
const candidatesSchema = z.object({ scoreRaw: rawSchema });
const upsertSchema = z.object({
  periodKey: dayKeySchema,
  scoreRaw: rawSchema,
  pick: pickSchema.optional(),
  overrodeRole: roleSchema.optional(),
  previewSeen: z.boolean().optional(),
  wrongGame: z.object({ gameId: z.string().uuid(), choice: z.enum(["here", "there"]) }).optional(),
});
const applyPickSchema = z.object({ pick: pickSchema, overrodeRole: roleSchema.optional() });
const teachSchema = z.object({
  periodKey: dayKeySchema,
  scoreDirection: directionSchema.optional(),
});
const setDirectionSchema = z.object({ scoreDirection: directionSchema });
const rollbackSchema = z.object({ version: z.number().int().min(1) });

const perUser = (c: Context) => c.get("userId") ?? null;
const DAY_SEC = 24 * 60 * 60;

/** 404 — not 403 — so the surface is indistinguishable from absent when off. */
const requireTeach: MiddlewareHandler = async (c, next) => {
  if (teachModeFor(c.get("userId")) !== "on") return err(c, "NOT_FOUND", "not found");
  await next();
};

function logContext(c: Context, game?: DbGame, periodKey?: string): TeachLogContext {
  return {
    requestId: c.get("requestId"),
    userId: c.get("userId"),
    gameId: game?.id,
    periodKey,
    parserVersion: game?.codeVersion,
  };
}

function rejectInput(
  c: Context,
  context: TeachLogContext,
  reason: ScoreInputRejection,
  raw: string,
) {
  logTeachEvent("score_input_rejected", context, {
    reason,
    raw_length: raw.length,
    raw: raw.slice(0, 2000),
  });
  const details: ScoreInputRejectedDetails = { code: "SCORE_INPUT_REJECTED", reason };
  return err(c, "VALIDATION", `score text rejected: ${reason}`, details);
}

async function loadGame(c: Context): Promise<DbGame | null> {
  const gameId = uuidSchema.safeParse(c.req.param("id"));
  if (!gameId.success) return null;
  const [game] = await getDb().select().from(games).where(eq(games.id, gameId.data)).limit(1);
  return game ?? null;
}

function recognitionCandidate(game: DbGame) {
  return { id: game.id, title: game.title, normalizedUrl: game.normalizedUrl };
}

/**
 * `PUT /v1/games/:id/scores` for a caller with teach on — the handler in
 * `games.ts` hands over to this before reading the body. Same contract as the
 * legacy post plus: the edge-input gate, code-based parsing with status /
 * source / parser version stored, and an optional pick.
 */
export async function handleScoreUpsertV2(c: Context, gameId: string): Promise<Response> {
  const userId = c.get("userId");
  const parsed = await parseJsonBody(c, upsertSchema);
  if (!parsed.ok) return parsed.response;
  const { periodKey, scoreRaw } = parsed.data;

  const db = getDb();
  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game) return err(c, "NOT_FOUND", "game not found");
  const context = logContext(c, game, periodKey);

  const rejection = checkScoreInput({
    raw: scoreRaw,
    periodKey,
    today: todayPeriodKey(),
    games: [recognitionCandidate(game)],
  });
  if (rejection) return rejectInput(c, context, rejection, scoreRaw);
  // Guideline 1.2: the pasted share text is shown verbatim to friends.
  if (containsObjectionableContent(scoreRaw)) {
    return err(c, "VALIDATION", OBJECTIONABLE_CONTENT_MESSAGE, { code: "OBJECTIONABLE_CONTENT" });
  }

  const isFirstScore = opsNotificationsEnabled() && !(await userHasAnyScore(userId, db));
  let saved: Awaited<ReturnType<typeof saveScore>>;
  try {
    saved = await saveScore({
      context,
      userId,
      game,
      periodKey,
      raw: scoreRaw,
      pick: parsed.data.pick,
      overrodeRole: parsed.data.overrodeRole,
      previewSeen: parsed.data.previewSeen,
    });
  } catch (error) {
    if (error instanceof InvalidPickError) return err(c, "VALIDATION", error.message);
    throw error;
  }

  await addToMyGames(userId, game.id);
  if (isFirstScore) await notifyFirstScore(userId, game.title);
  if (parsed.data.wrongGame) {
    logTeachEvent("game_recognition", context, {
      warned_game_id: parsed.data.wrongGame.gameId,
      warning_shown: true,
      user_choice: parsed.data.wrongGame.choice,
    });
  }
  await shadowRecognizePostedScore({ userId, gameId: game.id, periodKey, scoreRaw });

  const response: UpsertGameScoreResponse = {
    score: toScoreShape(saved.row),
    ...(saved.teach ? { teach: saved.teach } : {}),
  };
  return ok(c, response);
}

/**
 * `POST /v1/games/:id/scores/preview` for a caller with teach on — the
 * handler in `games.ts` hands over to this. The foundation's preview (status,
 * value, summary) plus `teach`: the computed candidates, the derivation, any
 * wrong-game match and any same-text day, behind the edge-input gate. Stores
 * nothing and calls no model.
 */
export async function handleScorePreviewV2(c: Context, gameId: string): Promise<Response> {
  const parsed = await parseJsonBody(c, previewSchema);
  if (!parsed.ok) return parsed.response;
  const [game] = await getDb().select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game) return err(c, "NOT_FOUND", "game not found");
  const today = todayPeriodKey();
  const { scoreRaw } = parsed.data;
  const periodKey = parsed.data.periodKey ?? today;
  const context = logContext(c, game, periodKey);
  const rejection = checkScoreInput({
    raw: scoreRaw,
    periodKey,
    today,
    games: [recognitionCandidate(game)],
  });
  if (rejection) return rejectInput(c, context, rejection, scoreRaw);
  const response: PreviewGameScoreResponse = {
    preview: await previewScore({
      context,
      userId: c.get("userId"),
      game,
      raw: scoreRaw,
      periodKey,
      entry: parsed.data.entry ?? "paste",
    }),
  };
  return ok(c, response);
}

export function registerGameTeachRoutes(router: Hono): void {
  /**
   * The share flow's preview: text with no game chosen. Recognises the game
   * (cheap match first; the classifier inside its budget) and previews the
   * post against it. No match is not an error — the user picks a game.
   */
  router.post(
    "/score-preview",
    requireTeach,
    rateLimit({ family: "v1.games.score-preview", limit: 60, windowSec: 60, key: perUser }),
    async (c) => {
      const userId = c.get("userId");
      const parsed = await parseJsonBody(c, sharePreviewSchema);
      if (!parsed.ok) return parsed.response;
      const { scoreRaw, periodKey } = parsed.data;
      const context = logContext(c, undefined, periodKey);
      const today = todayPeriodKey();
      const early = checkScoreInput({ raw: scoreRaw, periodKey, today, games: [] });
      if (early) return rejectInput(c, context, early, scoreRaw);

      const recognition =
        recognitionModeFor(userId) === "on"
          ? await recognizeGameForUser(userId, scoreRaw, { budgetMs: 1000 })
          : null;
      // Title-only needs the titles: the caller's games and any the text names.
      const titled = checkScoreInput({
        raw: scoreRaw,
        periodKey,
        today,
        games: (recognition?.candidates ?? []).map((row) => recognitionCandidate(row.game)),
      });
      if (titled) return rejectInput(c, context, titled, scoreRaw);

      const result = recognition?.result ?? null;
      const match = recognition?.match ?? null;
      const surfaced =
        result !== null && match !== null && result.confidence >= RECOGNITION_SURFACE_THRESHOLD;
      logTeachEvent(
        "game_recognition",
        { ...context, gameId: surfaced ? match.game.id : undefined },
        {
          entry: "share",
          method: result?.method ?? null,
          confidence: result?.confidence ?? null,
          candidates: recognition?.candidates.length ?? 0,
          game_chosen: surfaced ? match.game.id : null,
          warning_shown: false,
        },
      );
      if (!surfaced) {
        const response: SharePreviewResponse = { match: null, preview: null };
        return ok(c, response);
      }
      const preview = await previewScore({
        context: logContext(c, match.game, periodKey),
        userId,
        game: match.game,
        raw: scoreRaw,
        periodKey,
        entry: "share",
        // The game was just recognised from this text; don't ask again.
        skipRecognition: true,
      });
      const response: SharePreviewResponse = {
        match: {
          game: toGameShape(match.game),
          inMyGames: match.inMyGames,
          confidence: result.confidence,
          method: result.method,
        },
        preview,
      };
      return ok(c, response);
    },
  );

  /**
   * The picker's candidates with role labels (teach step 1). The candidates
   * are computed here, deterministically; the model only labels them, and a
   * slow or failed call returns the same candidates unlabelled.
   */
  router.post(
    "/:id/scores/candidates",
    requireTeach,
    rateLimit({ family: "v1.games.scores.candidates", limit: 12, windowSec: 60, key: perUser }),
    rateLimit({
      family: "v1.games.scores.candidates.day",
      limit: 150,
      windowSec: DAY_SEC,
      key: perUser,
    }),
    async (c) => {
      const parsed = await parseJsonBody(c, candidatesSchema);
      if (!parsed.ok) return parsed.response;
      const game = await loadGame(c);
      if (!game) return err(c, "NOT_FOUND", "game not found");
      const { scoreRaw } = parsed.data;
      const context = logContext(c, game);
      const today = todayPeriodKey();
      const rejection = checkScoreInput({
        raw: scoreRaw,
        periodKey: today,
        today,
        games: [recognitionCandidate(game)],
      });
      if (rejection) return rejectInput(c, context, rejection, scoreRaw);

      const candidates = computeScoreFeatures(scoreRaw, {
        knownSymbols: await knownSymbolsFor(game.id),
      });
      const response: ScoreCandidatesResponse = {
        candidates,
        roles: {},
        scoreId: null,
        labelled: false,
      };
      if (candidates.length === 0) return ok(c, response);
      // The global daily cap on model calls: once spent, chips stay unlabelled.
      if (!(await claimTeachLlmCall("find_targets", context))) return ok(c, response);
      const requestStartedAt = Date.now();
      const found = await findTargets(
        { gameTitle: game.title, raw: scoreRaw, features: candidates },
        { timeoutMs: FIND_TARGETS_TIMEOUT_MS },
      );
      // Step 1's latency, under the same field names step 2 uses on
      // `parser_accept`, so one CloudWatch query reads p50/p95 for either.
      logger.info("teach_targets", {
        kind: "teach_targets",
        step: "find_targets",
        request_id: context.requestId,
        user_id: context.userId,
        game_id: game.id,
        model: found.model,
        outcome: found.ok ? "labelled" : found.reason,
        llm_ms: found.durationMs,
        llm_budget_ms: FIND_TARGETS_TIMEOUT_MS,
        llm_timed_out: !found.ok && found.reason === "timeout",
        // The model call plus the budget claim's wait — what the picker waited.
        elapsed_ms: Date.now() - requestStartedAt,
        // Kept for anything already reading it; same value as `llm_ms`.
        duration_ms: found.durationMs,
        input_tokens: found.ok ? found.usage.inputTokens : null,
        output_tokens: found.ok ? found.usage.outputTokens : null,
        score_id: found.ok ? found.targets.scoreId : null,
        candidates: candidates.length,
      });
      if (found.ok) {
        response.roles = found.targets.roles;
        response.scoreId = found.targets.scoreId;
        response.labelled = true;
      }
      return ok(c, response);
    },
  );

  router.post(
    "/:id/scores/:periodKey/pick",
    requireTeach,
    rateLimit({ family: "v1.games.scores.pick", limit: 30, windowSec: 60, key: perUser }),
    async (c) => {
      const periodKey = dayKeySchema.safeParse(c.req.param("periodKey"));
      if (!periodKey.success) return err(c, "VALIDATION", "invalid period");
      const parsed = await parseJsonBody(c, applyPickSchema);
      if (!parsed.ok) return parsed.response;
      const game = await loadGame(c);
      if (!game) return err(c, "NOT_FOUND", "game not found");
      try {
        const applied = await applyPick({
          context: logContext(c, game, periodKey.data),
          userId: c.get("userId"),
          game,
          periodKey: periodKey.data,
          pick: parsed.data.pick,
          overrodeRole: parsed.data.overrodeRole,
        });
        // Only ever the caller's own row: someone else's score 404s like a missing one.
        if (!applied) return err(c, "NOT_FOUND", "score not found");
        const response: ApplyScorePickResponse = {
          score: toScoreShape(applied.row),
          teach: applied.teach,
        };
        return ok(c, response);
      } catch (error) {
        if (error instanceof InvalidPickError) return err(c, "VALIDATION", error.message);
        throw error;
      }
    },
  );

  /**
   * Teach the game's parser from the caller's own picked score (teach step
   * 2 + the acceptance gates). Takes no value from the client — only which of
   * the caller's rows to learn from. Always 200: a rejected or unavailable
   * teach is an outcome, not an error, and the caller's own score is already
   * fixed either way.
   */
  router.post(
    "/:id/parser/teach",
    requireTeach,
    rateLimit({ family: "v1.games.parser.teach", limit: 6, windowSec: 60, key: perUser }),
    rateLimit({ family: "v1.games.parser.teach.day", limit: 40, windowSec: DAY_SEC, key: perUser }),
    async (c) => {
      const parsed = await parseJsonBody(c, teachSchema);
      if (!parsed.ok) return parsed.response;
      const game = await loadGame(c);
      if (!game) return err(c, "NOT_FOUND", "game not found");
      const result = await teachFromPick({
        context: logContext(c, game, parsed.data.periodKey),
        userId: c.get("userId"),
        game,
        periodKey: parsed.data.periodKey,
        scoreDirection: parsed.data.scoreDirection,
      });
      if (!result) return err(c, "NOT_FOUND", "score not found");
      const response: TeachParserResponse = {
        outcome: result.outcome,
        game: toGameShape(result.game),
        score: toScoreShape(result.score),
      };
      return ok(c, response);
    },
  );

  router.put(
    "/:id/score-direction",
    requireTeach,
    rateLimit({ family: "v1.games.score-direction", limit: 20, windowSec: 60, key: perUser }),
    async (c) => {
      const parsed = await parseJsonBody(c, setDirectionSchema);
      if (!parsed.ok) return parsed.response;
      const game = await loadGame(c);
      if (!game) return err(c, "NOT_FOUND", "game not found");
      const result = await requestDirection({
        context: logContext(c, game),
        userId: c.get("userId"),
        game,
        direction: parsed.data.scoreDirection,
      });
      const response: SetScoreDirectionResponse = {
        game: toGameShape(result.game),
        applied: result.applied,
      };
      return ok(c, response);
    },
  );

  /** Operator-only: put an earlier version of the code back (as a new version). */
  router.post(
    "/:id/parser/rollback",
    rateLimit({ family: "v1.games.parser.rollback", limit: 10, windowSec: 60, key: perUser }),
    async (c) => {
      const userId = c.get("userId");
      const [actor] = await getDb()
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!actor || !isAdminUser(actor)) return err(c, "NOT_FOUND", "not found");
      const parsed = await parseJsonBody(c, rollbackSchema);
      if (!parsed.ok) return parsed.response;
      const game = await loadGame(c);
      if (!game) return err(c, "NOT_FOUND", "game not found");
      const updated = await rollbackParser({
        context: logContext(c, game),
        userId,
        game,
        toVersion: parsed.data.version,
      });
      if (!updated) return err(c, "VALIDATION", "no such earlier version to roll back to");
      return ok(c, { game: toGameShape(updated), codeVersion: updated.codeVersion });
    },
  );
}
