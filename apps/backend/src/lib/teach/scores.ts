// Score-level half of teach v2: the dry-run preview, the score write with an
// optional pick, and applying a pick to an existing row. No LLM is called
// from here — an ordinary post runs the game's stored code in the sandbox and
// nothing else.

import type { GameScoreEntrySource } from "@workshop/shared/constants";
import type {
  Game,
  GameScore,
  GameScorePreview,
  ScoreEntryPoint,
  ScorePickFields,
  ScoreTeachHint,
} from "@workshop/shared/games";
import {
  computeScoreFeatures,
  derivationForValue,
  findScoreFeature,
  type ScoreFeature,
  type ScoreFeatureRole,
  type ScorePick,
  suggestDirectionForFeature,
} from "@workshop/shared/scoreCandidates";
import { and, desc, eq, gte, ne } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { type DbGame, type DbGameScore, gameScores } from "../../db/schema.js";
import { toIsoString } from "../dates.js";
import { parseScoreValue, specForGame } from "../gameCatalog.js";
import { FUEL_TICKS, HARD_TIMEOUT_MS, MEMORY_LIMIT_BYTES } from "../gameCode/limits.js";
import type { ParseStatus } from "../gameCode/scoring.js";
import type { FormatResult, ParseResult } from "../gameCode/types.js";
import { resolvePostedScore, scoreCodeFields, scoreShareWithinBudget } from "../gameCodeService.js";
import { matchByUrlOrLabel, RECOGNITION_SURFACE_THRESHOLD } from "../gameRecognition.js";
import { recognitionModeFor, recognizeGameForUser } from "../gameRecognitionService.js";
import { todayPeriodKey, toGameShape } from "../gameShapes.js";
import type { DbClient } from "../sql.js";
import { logTeachEvent, type TeachLogContext } from "./log.js";
import type { StoredPick } from "./types.js";
import { pickValue } from "./types.js";

/** How far back confirmed picks and read scores constrain new parser code. */
const TEACH_WINDOW_DAYS = 30;
/**
 * What recognition may add to a preview. The cheap label/URL match is
 * microseconds; this bounds the classifier, whose answer is dropped when it
 * misses the budget so the whole preview stays near 1.5s.
 */
const PREVIEW_RECOGNITION_BUDGET_MS = 1000;
const PREVIEW_RECOGNITION_CAP_MS = PREVIEW_RECOGNITION_BUDGET_MS + 100;

/** Teach v2's fields of a score for an API response. */
export function scorePickFields(row: {
  scoreSource: string | null;
  pickAdjusted: boolean;
}): ScorePickFields {
  return {
    scoreSource: row.scoreSource === "picked" ? "picked" : "parsed",
    adjusted: row.pickAdjusted,
  };
}

export function toScoreShape(row: DbGameScore): GameScore {
  return {
    gameId: row.gameId,
    userId: row.userId,
    periodKey: row.periodKey,
    scoreValue: row.scoreValue === null ? null : Number(row.scoreValue),
    scoreRaw: row.scoreRaw,
    ...scoreCodeFields(row),
    ...scorePickFields(row),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

/** Read a `game_scores.pick` jsonb value back into a pick. Null when absent or malformed. */
export function storedPickOf(value: unknown): StoredPick | null {
  if (typeof value !== "object" || value === null) return null;
  const pick = value as { kind?: unknown; feature?: unknown };
  if (pick.kind === "no_result") return { kind: "no_result" };
  if (pick.kind !== "feature" || typeof pick.feature !== "object" || pick.feature === null) {
    return null;
  }
  const feature = pick.feature as Partial<ScoreFeature>;
  if (typeof feature.id !== "string" || typeof feature.value !== "number") return null;
  return { kind: "feature", feature: feature as ScoreFeature };
}

/** Whether the text positively names this game by its link or its title — never the classifier. */
function textNamesGame(raw: string, game: DbGame): boolean {
  const self = { id: game.id, title: game.title, normalizedUrl: game.normalizedUrl };
  return matchByUrlOrLabel(raw, [self]).hits.includes(game.id);
}

/**
 * Symbols this game's score has been counted from in recent confirmed picks,
 * so an all-❌ grid still offers `0 × 🏆`. One bounded scan of the game's
 * 30-day window on the `(game_id, period_key)` index.
 */
export async function knownSymbolsFor(gameId: string, db: DbClient = getDb()): Promise<string[]> {
  const since = windowStartKey();
  const rows = await db
    .select({ pick: gameScores.pick })
    .from(gameScores)
    .where(
      and(
        eq(gameScores.gameId, gameId),
        gte(gameScores.periodKey, since),
        eq(gameScores.pickIsExample, true),
      ),
    )
    .limit(200);
  const symbols = new Set<string>();
  for (const row of rows) {
    const pick = storedPickOf(row.pick);
    if (pick?.kind === "feature" && pick.feature.kind === "symbolCount" && pick.feature.symbol) {
      symbols.add(pick.feature.symbol);
    }
  }
  return [...symbols];
}

/** The first puzzle day inside the acceptance window. */
export function windowStartKey(today: string = todayPeriodKey()): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - TEACH_WINDOW_DAYS);
  return date.toISOString().slice(0, 10);
}

const SANDBOX_LIMIT_REASONS = new Set([
  "timeout",
  "out_of_memory",
  "too_large",
  "sandbox_unavailable",
  "invalid_code",
  "missing_function",
]);

/** Log a parse that failed because of the sandbox or the code itself, not the text. */
export function logSandboxFailure(
  context: TeachLogContext,
  parse: ParseResult | FormatResult,
  which: "parser" | "candidate" | "formatter",
  durationMs: number,
): void {
  if (parse.kind !== "failed" || !SANDBOX_LIMIT_REASONS.has(parse.reason)) return;
  logTeachEvent("sandbox_failure", context, {
    reason: parse.reason,
    detail: parse.detail ?? null,
    code: which,
    duration_ms: durationMs,
    limits: {
      fuel_ticks: FUEL_TICKS,
      wall_clock_ms: HARD_TIMEOUT_MS,
      memory_bytes: MEMORY_LIMIT_BYTES,
    },
  });
}

function resolves<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** The day, other than this one, the user already posted this exact text to this game. */
async function sameTextDay(
  userId: string,
  gameId: string,
  periodKey: string,
  raw: string,
  db: DbClient,
): Promise<string | null> {
  const [row] = await db
    .select({ periodKey: gameScores.periodKey })
    .from(gameScores)
    .where(
      and(
        eq(gameScores.gameId, gameId),
        eq(gameScores.userId, userId),
        eq(gameScores.scoreRaw, raw),
        ne(gameScores.periodKey, periodKey),
      ),
    )
    .orderBy(desc(gameScores.periodKey))
    .limit(1);
  return row?.periodKey ?? null;
}

interface WrongGame {
  game: Game;
  inMyGames: boolean;
  method: string;
  confidence: number;
}

/**
 * Does the text positively match a *different* game? A text that names this
 * game never warns. Otherwise recognition runs inside the preview's budget;
 * a classifier answer that misses it is dropped (`inBudget: false`).
 */
async function wrongGameFor(
  userId: string,
  game: DbGame,
  raw: string,
): Promise<{ wrongGame: WrongGame | null; ran: boolean; inBudget: boolean; candidates: number }> {
  if (textNamesGame(raw, game) || recognitionModeFor(userId) !== "on") {
    return { wrongGame: null, ran: false, inBudget: true, candidates: 0 };
  }
  const recognition = await resolves(
    recognizeGameForUser(userId, raw, {
      budgetMs: PREVIEW_RECOGNITION_BUDGET_MS,
      includeGameIds: [game.id],
    }),
    PREVIEW_RECOGNITION_CAP_MS,
  );
  if (!recognition) return { wrongGame: null, ran: true, inBudget: false, candidates: 0 };
  const { result, match, candidates, trace } = recognition;
  const inBudget = !(trace.judgeCalled && trace.judgeFailed);
  const positive =
    result !== null &&
    match !== null &&
    result.gameId !== game.id &&
    result.confidence >= RECOGNITION_SURFACE_THRESHOLD;
  return {
    wrongGame: positive
      ? {
          game: toGameShape(match.game),
          inMyGames: match.inMyGames,
          method: result.method,
          confidence: result.confidence,
        }
      : null,
    ran: true,
    inBudget,
    candidates: candidates.length,
  };
}

/**
 * Dry-run a post: what the game's parser makes of the text, the computed
 * candidates, any wrong-game match and any same-text day. Stores nothing and
 * calls no LLM.
 */
export async function previewScore(input: {
  context: TeachLogContext;
  userId: string;
  game: DbGame;
  raw: string;
  periodKey: string;
  entry: ScoreEntryPoint;
  /** The game was just recognised from this very text (the share flow). */
  skipRecognition?: boolean;
  db?: DbClient;
}): Promise<GameScorePreview> {
  const { userId, game, raw, periodKey } = input;
  const db = input.db ?? getDb();
  const startedAt = Date.now();
  const [scored, wrong, sameText, knownSymbols] = await Promise.all([
    // The same stored code, under the same budget, as the real post.
    scoreShareWithinBudget(game, raw),
    input.skipRecognition
      ? { wrongGame: null, ran: false, inBudget: true, candidates: 0 }
      : wrongGameFor(userId, game, raw),
    sameTextDay(userId, game.id, periodKey, raw, db),
    knownSymbolsFor(game.id, db),
  ]);
  const { parse } = scored;
  logSandboxFailure(input.context, parse, "parser", scored.durationMs);

  const value = scored.scoreValue;
  const teach = {
    derivation: value === null ? null : derivationForValue(raw, value),
    candidates: computeScoreFeatures(raw, { knownSymbols }),
    wrongGame: wrong.wrongGame
      ? { game: wrong.wrongGame.game, inMyGames: wrong.wrongGame.inMyGames }
      : null,
    sameTextPeriodKey: sameText,
    hasParser: game.parseCode !== null,
  };
  const preview: GameScorePreview = {
    parseStatus: scored.parseStatus,
    scoreValue: value,
    scoreSummary: scored.scoreSummary,
    teach,
  };
  logTeachEvent("score_preview", input.context, {
    entry: input.entry,
    status: scored.parseStatus === "failed" ? "unread" : scored.parseStatus,
    value,
    derivation: teach.derivation,
    unread_reason: parse.kind === "failed" ? parse.reason : null,
    candidates: teach.candidates.map((c) => c.label),
    wrong_game_id: wrong.wrongGame?.game.id ?? null,
    same_text_day: sameText,
    classifier_in_budget: wrong.inBudget,
    raw,
    duration_ms: Date.now() - startedAt,
  });
  if (wrong.ran) {
    logTeachEvent("game_recognition", input.context, {
      method: wrong.wrongGame?.method ?? null,
      confidence: wrong.wrongGame?.confidence ?? null,
      candidates: wrong.candidates,
      game_chosen: wrong.wrongGame?.game.id ?? null,
      warning_shown: wrong.wrongGame !== null,
      in_budget: wrong.inBudget,
    });
  }
  return preview;
}

/**
 * "Adjusted": the shared parser read this text and got something other than
 * what the player picked. A text the parser could not read at all — or a game
 * with no parser — is not a disagreement, so it is never labelled.
 */
export function isAdjusted(pick: StoredPick, parse: ParseResult): boolean {
  if (pick.kind !== "feature" || parse.kind === "failed") return false;
  return !(parse.kind === "score" && parse.value === pick.feature.value);
}

/** A pick that names a candidate the text does not have. */
export class InvalidPickError extends Error {
  constructor() {
    super("pick does not match a candidate in this text");
  }
}

interface ResolvedPick {
  stored: StoredPick;
  status: ParseStatus;
  value: number | null;
  isExample: boolean;
  /** The parser reads the text and gets a different result (see `isAdjusted`). */
  adjusted: boolean;
  /** The parser does not already produce this pick. */
  parserDisagrees: boolean;
  /** The parser could not read the text at all. */
  parserUnread: boolean;
}

async function resolvePick(
  game: DbGame,
  raw: string,
  pick: ScorePick,
  parse: ParseResult,
  db: DbClient,
): Promise<ResolvedPick> {
  const isExample = textNamesGame(raw, game);
  if (pick.kind === "no_result") {
    return {
      stored: { kind: "no_result" },
      status: "no_result",
      value: null,
      isExample,
      adjusted: false,
      parserDisagrees: parse.kind !== "noResult",
      parserUnread: parse.kind === "failed",
    };
  }
  const knownSymbols = await knownSymbolsFor(game.id, db);
  const feature = findScoreFeature(raw, pick.featureId, { knownSymbols });
  if (!feature) throw new InvalidPickError();
  const agrees = parse.kind === "score" && parse.value === feature.value;
  const stored: StoredPick = { kind: "feature", feature };
  return {
    stored,
    status: "score",
    value: feature.value,
    isExample,
    adjusted: isAdjusted(stored, parse),
    parserDisagrees: !agrees,
    parserUnread: parse.kind === "failed",
  };
}

function teachHint(game: DbGame, pick: ResolvedPick): ScoreTeachHint {
  const firstTeach = game.parseCode === null;
  // "I didn't finish" teaches only a loss shape the parser could not read at
  // all. Where the parser reads a score, or the game has no parser, the pick
  // fixes the player's own row and nothing else.
  const learnable = pick.stored.kind === "feature" || (!firstTeach && pick.parserUnread);
  return {
    eligible: pick.isExample && pick.parserDisagrees && learnable,
    needsDirection: firstTeach && pick.stored.kind === "feature",
    suggestedDirection:
      pick.stored.kind === "feature" ? suggestDirectionForFeature(pick.stored.feature) : null,
  };
}

function logPick(
  context: TeachLogContext,
  previous: DbGameScore | undefined,
  pick: ResolvedPick,
  hint: ScoreTeachHint,
  overrodeRole: ScoreFeatureRole | undefined,
  raw: string,
): void {
  const feature = pick.stored.kind === "feature" ? pick.stored.feature : null;
  logTeachEvent("score_pick", context, {
    candidate_kind: feature?.kind ?? "no_result",
    candidate_id: feature?.id ?? null,
    candidate_value: pickValue(pick.stored),
    previous_status: previous?.parseStatus ?? null,
    previous_value: previous?.scoreValue == null ? null : Number(previous.scoreValue),
    previous_source: previous?.scoreSource ?? null,
    label_mismatch_confirmed: overrodeRole ?? null,
    training_example: pick.isExample,
    not_example_reason: pick.isExample ? null : "text does not name the game by label or url",
    teach_eligible: hint.eligible,
    raw,
  });
}

/**
 * Post a score (teach v2 write path): run the game's code, apply the pick if
 * there is one, and store value, status, source, parser version and summary.
 * A pick always wins on the player's own row; whether it also teaches the
 * game is the caller's next request (`teachFromPick`).
 */
export async function saveScore(input: {
  context: TeachLogContext;
  userId: string;
  game: DbGame;
  periodKey: string;
  raw: string;
  pick?: ScorePick | undefined;
  overrodeRole?: ScoreFeatureRole | undefined;
  previewSeen?: boolean | undefined;
  /** The surface the post came from; absent (older client) stores NULL. */
  entrySource?: GameScoreEntrySource | undefined;
  db?: DbClient;
}): Promise<{ row: DbGameScore; teach: ScoreTeachHint | null }> {
  const { userId, game, periodKey, raw } = input;
  const db = input.db ?? getDb();
  const context = { ...input.context, parserVersion: game.codeVersion };
  const startedAt = Date.now();
  // Bounded and fail-soft: a slow or broken parser makes the score unread,
  // never the request.
  const scored = await scoreShareWithinBudget(game, raw);
  const durationMs = Date.now() - startedAt;
  logSandboxFailure(context, scored.parse, "parser", durationMs);
  if (scored.format) logSandboxFailure(context, scored.format, "formatter", durationMs);

  const pick = input.pick ? await resolvePick(game, raw, input.pick, scored.parse, db) : null;
  const [previous] = pick
    ? await db
        .select()
        .from(gameScores)
        .where(
          and(
            eq(gameScores.gameId, game.id),
            eq(gameScores.userId, userId),
            eq(gameScores.periodKey, periodKey),
          ),
        )
        .limit(1)
    : [];

  // The sandbox — not the code — failed to answer: an ordinary post defers to
  // the code-parsing layer's rule for that (keep a legacy spec's reading,
  // else store it unread), so the two write paths cannot disagree.
  const sandboxDown =
    scored.capped ||
    (scored.parse.kind === "failed" && scored.parse.reason === "sandbox_unavailable");
  const fallback =
    !pick && sandboxDown
      ? // Handed the result it would otherwise wait another budget to get.
        await resolvePostedScore({ userId, game, periodKey, scoreRaw: raw, scored })
      : null;

  const values = fallback
    ? {
        scoreRaw: raw,
        scoreValue: fallback.scoreValue === null ? null : String(fallback.scoreValue),
        parseStatus: fallback.parseStatus,
        scoreSummary: fallback.scoreSummary,
        codeVersion: fallback.codeVersion,
        scoreSource: fallback.scoreSource,
        pick: null,
        pickIsExample: false,
        pickAdjusted: false,
        updatedAt: new Date(),
      }
    : {
        scoreRaw: raw,
        scoreValue: pick
          ? pick.value === null
            ? null
            : String(pick.value)
          : scored.scoreValue === null
            ? null
            : String(scored.scoreValue),
        parseStatus: pick ? pick.status : scored.parseStatus,
        scoreSummary: scored.scoreSummary,
        codeVersion: game.codeVersion,
        scoreSource: pick ? "picked" : "parsed",
        pick: pick ? pick.stored : null,
        pickIsExample: pick?.isExample ?? false,
        pickAdjusted: pick?.adjusted ?? false,
        updatedAt: new Date(),
      };
  // Every write sets it, so a post without it does not keep an older surface.
  const columns = { ...values, entrySource: input.entrySource ?? null };
  const [row] = await db
    .insert(gameScores)
    .values({ gameId: game.id, userId, periodKey, ...columns })
    .onConflictDoUpdate({
      target: [gameScores.gameId, gameScores.userId, gameScores.periodKey],
      set: columns,
    })
    .returning();
  if (!row) throw new Error("score upsert returned no row");

  logTeachEvent("score_parse", context, {
    status: values.parseStatus === "failed" ? "unread" : values.parseStatus,
    value: values.scoreValue === null ? null : Number(values.scoreValue),
    unread_reason: scored.parse.kind === "failed" ? scored.parse.reason : null,
    unread_detail: scored.parse.kind === "failed" ? (scored.parse.detail ?? null) : null,
    source: values.scoreSource,
    // What the registry / first-number parser would have stored, for comparison.
    legacy_value: parseScoreValue(raw, specForGame(game)),
    duration_ms: durationMs,
    preview_seen: input.previewSeen ?? null,
    entry_source: input.entrySource ?? null,
    raw,
  });
  const teach = pick ? teachHint(game, pick) : null;
  if (pick && teach) logPick(context, previous, pick, teach, input.overrodeRole, raw);
  return { row, teach };
}

/**
 * "Fix score": apply a pick to the caller's own existing row. The text and
 * the day stay as posted; only what counts as the score changes.
 */
export async function applyPick(input: {
  context: TeachLogContext;
  userId: string;
  game: DbGame;
  periodKey: string;
  pick: ScorePick;
  overrodeRole?: ScoreFeatureRole | undefined;
  db?: DbClient;
}): Promise<{ row: DbGameScore; teach: ScoreTeachHint } | null> {
  const { userId, game, periodKey } = input;
  const db = input.db ?? getDb();
  const context = { ...input.context, parserVersion: game.codeVersion };
  const mine = and(
    eq(gameScores.gameId, game.id),
    eq(gameScores.userId, userId),
    eq(gameScores.periodKey, periodKey),
  );
  const [previous] = await db.select().from(gameScores).where(mine).limit(1);
  if (!previous) return null;

  const startedAt = Date.now();
  const { parse } = await scoreShareWithinBudget(game, previous.scoreRaw);
  logSandboxFailure(context, parse, "parser", Date.now() - startedAt);
  const pick = await resolvePick(game, previous.scoreRaw, input.pick, parse, db);
  const [row] = await db
    .update(gameScores)
    .set({
      scoreValue: pick.value === null ? null : String(pick.value),
      parseStatus: pick.status,
      codeVersion: game.codeVersion,
      scoreSource: "picked",
      pick: pick.stored,
      pickIsExample: pick.isExample,
      pickAdjusted: pick.adjusted,
      updatedAt: new Date(),
    })
    .where(mine)
    .returning();
  if (!row) return null;
  const teach = teachHint(game, pick);
  logPick(context, previous, pick, teach, input.overrodeRole, previous.scoreRaw);
  return { row, teach };
}
