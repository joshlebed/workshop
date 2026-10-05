// TypeSafe "System One" client (Jev) — one POST, one tight timeout, no retries.
//
// Plain `fetch` rather than `@typesafe-ai/sdk`: the SDK defaults to a 10s
// per-attempt timeout with two retries and no total budget, which is the
// opposite of what a 15s Lambda needs. Every caller here treats Jev as an
// optional second opinion, so a slow or failing call returns null and the
// caller carries on without it. API reference: https://docs.typesafe.ai/api.md

import { z } from "zod";
import { getConfig } from "./config.js";
import type { JudgeRequest, JudgeVerdict } from "./gameRecognition.js";
import { logger } from "./logger.js";

const SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone";
// Pinned, not `jev-latest`: the recognition thresholds were measured against
// this version. Move it deliberately, with an eval re-run.
export const JEV_MODEL = "jev-1.13.0";
/**
 * One attempt, no retries. The eval measured p50 ~120ms / p95 ~250ms from the
 * Niteshift sandbox; this leaves room for a cold connection without stalling
 * a paste or a score post.
 */
const JEV_TIMEOUT_MS = 1500;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

type SystemOneQuestion =
  | { type: "choice"; instructions: Json; criteria: Record<string, Json> }
  | { type: "noul"; instructions: Json; criteria?: { true?: Json; false?: Json } };

const answerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    probabilities: z.record(z.string(), z.number()),
    confidence: z.number(),
  }),
  z.object({ type: z.literal("noul"), noul: z.number() }),
  z.object({ type: z.literal("score"), score: z.number(), confidence: z.number() }),
]);

const responseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), answerSchema),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

type SystemOneResponse = z.infer<typeof responseSchema>;

interface SystemOneOptions {
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Evaluate `questions` against `state`. Returns null — never throws — when
 * Jev is unconfigured, slow, erroring or returns something unexpected.
 */
export async function systemOne(
  state: Json,
  questions: Record<string, SystemOneQuestion>,
  options: SystemOneOptions = {},
): Promise<SystemOneResponse | null> {
  const apiKey = options.apiKey ?? getConfig().typesafeApiKey;
  if (!apiKey) return null;
  const startedAt = Date.now();
  try {
    const res = await (options.fetchImpl ?? fetch)(SYSTEM_ONE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal: AbortSignal.timeout(options.timeoutMs ?? JEV_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn("jev non-2xx", { status: res.status, durationMs: Date.now() - startedAt });
      return null;
    }
    const parsed = responseSchema.safeParse(await res.json());
    if (!parsed.success) {
      logger.warn("jev response failed validation", { error: parsed.error });
      return null;
    }
    return parsed.data;
  } catch (error) {
    logger.warn("jev call failed", { error, durationMs: Date.now() - startedAt });
    return null;
  }
}

const NONE = "none";

/**
 * Build the "which of these games, or none" Choice for a shortlist. Option
 * keys are positional (`game_1`…) because the model reads them as the option
 * names and game ids are meaningless uuids; the game's real name, url and
 * example scores are the option's description.
 */
export function buildRecognitionChoice(request: JudgeRequest): {
  state: Json;
  question: SystemOneQuestion;
  optionToGameId: Map<string, string>;
} {
  const optionToGameId = new Map<string, string>();
  const criteria: Record<string, Json> = {};
  request.games.forEach((game, i) => {
    const option = `game_${i + 1}`;
    optionToGameId.set(option, game.id);
    criteria[option] = {
      name: game.name,
      url: game.url,
      example_scores: game.examples,
    };
  });
  criteria[NONE] =
    "`pasted_text` is not a result from any of the listed games: ordinary text, a link, a result from some other game, or too little to tell.";
  return {
    state: { pasted_text: request.text },
    question: {
      type: "choice",
      instructions:
        "`pasted_text` is text a player pasted or shared. Which game is it a result/score share from? Each option is one daily game with its name, url and `example_scores` — real result shares from that game. A result from the same game has the same layout and wording as that game's examples; only the numbers, dates and emoji outcomes change from day to day.",
      criteria,
    },
    optionToGameId,
  };
}

/**
 * The production judge: one Jev Choice over the shortlist plus "none".
 * `timeoutMs` shortens (never lengthens) the default timeout — a caller with
 * a time budget passes what it has left.
 */
export async function jevRecognitionJudge(
  request: JudgeRequest,
  options: { timeoutMs?: number } = {},
): Promise<JudgeVerdict | null> {
  const { state, question, optionToGameId } = buildRecognitionChoice(request);
  const timeoutMs = Math.min(options.timeoutMs ?? JEV_TIMEOUT_MS, JEV_TIMEOUT_MS);
  const response = await systemOne(state, { game: question }, { timeoutMs });
  const answer = response?.answers.game;
  if (answer?.type !== "choice") return null;
  const probabilities: Record<string, number> = {};
  for (const [option, gameId] of optionToGameId) {
    probabilities[gameId] = answer.probabilities[option] ?? 0;
  }
  return { probabilities };
}
