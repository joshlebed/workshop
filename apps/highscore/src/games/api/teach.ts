// Teach v2 (`capabilities.teach` on `GET /v1/games`): score previews with
// computed candidates, the picker's role labels, picks ("Fix score"), parser
// teaching and score direction. Every endpoint 404s for an account without
// the capability, so check `useTeachAvailable` before calling. Responses are
// zod-validated; a preview or a label that fails validation resolves to null —
// a hint must never be the thing that breaks posting.

import { apiRequest } from "@workshop/api-client/api";
import { ApiError } from "@workshop/api-client/apiError";
import type {
  ApplyScorePickResponse,
  GameScoreDirection,
  ScoreEntryPoint,
  ScoreInputRejection,
  SetScoreDirectionResponse,
  TeachParserResponse,
} from "@workshop/shared/games";
import {
  SCORE_FEATURE_ROLES,
  type ScoreFeatureRole,
  type ScorePick,
} from "@workshop/shared/scoreCandidates";
import { z } from "zod";

const featureSchema = z.object({
  id: z.string(),
  kind: z.enum(["number", "fraction", "plus", "duration", "symbolCount", "rowCount", "position"]),
  value: z.number(),
  label: z.string(),
  derivation: z.string().nullable(),
  text: z.string().nullable(),
  start: z.number().nullable(),
  symbol: z.string().nullable(),
});

const gameRefSchema = z.object({ id: z.string(), title: z.string(), url: z.string() });

const previewSchema = z.object({
  parseStatus: z.enum(["score", "no_result", "failed"]),
  scoreValue: z.number().nullable(),
  scoreSummary: z.string().nullable(),
  teach: z
    .object({
      derivation: z.string().nullable(),
      candidates: z.array(featureSchema),
      wrongGame: z.object({ game: gameRefSchema, inMyGames: z.boolean() }).nullable(),
      sameTextPeriodKey: z.string().nullable(),
      hasParser: z.boolean(),
    })
    .optional(),
});

/** The teach-aware score preview, as this client reads it. */
export type TeachPreview = z.infer<typeof previewSchema>;

/** A preview answer: the dry run, or the reason the server refuses the text. */
export type PreviewAnswer =
  | { kind: "preview"; preview: TeachPreview }
  | { kind: "rejected"; reason: ScoreInputRejection };

const REJECTIONS: readonly ScoreInputRejection[] = [
  "empty",
  "url_only",
  "title_only",
  "too_long",
  "future_day",
];

/** The edge-input gate's reason, when `error` is its 400. */
export function scoreInputRejection(error: unknown): ScoreInputRejection | null {
  if (!(error instanceof ApiError)) return null;
  const details = error.details as { code?: unknown; reason?: unknown } | undefined;
  if (details?.code !== "SCORE_INPUT_REJECTED") return null;
  return REJECTIONS.find((r) => r === details.reason) ?? null;
}

/**
 * `POST /v1/games/:id/scores/preview` — what posting this text would store,
 * plus candidates, any wrong-game match and any same-text day. A text the
 * server refuses (link only, title only…) comes back as `rejected`, not an
 * error. Null when the response isn't the shape we expect.
 */
export async function previewTeachScore(
  gameId: string,
  body: { scoreRaw: string; periodKey: string; entry: ScoreEntryPoint },
  token: string | null,
  signal?: AbortSignal,
): Promise<PreviewAnswer | null> {
  try {
    const raw = await apiRequest<unknown>({
      method: "POST",
      path: `/v1/games/${gameId}/scores/preview`,
      body,
      token,
      ...(signal ? { signal } : {}),
    });
    const parsed = z.object({ preview: previewSchema }).safeParse(raw);
    return parsed.success ? { kind: "preview", preview: parsed.data.preview } : null;
  } catch (error) {
    const reason = scoreInputRejection(error);
    if (reason) return { kind: "rejected", reason };
    throw error;
  }
}

const sharePreviewSchema = z.object({
  match: z
    .object({
      game: gameRefSchema,
      inMyGames: z.boolean(),
      confidence: z.number(),
      method: z.string(),
    })
    .nullable(),
  preview: previewSchema.nullable(),
});

export type SharePreview = z.infer<typeof sharePreviewSchema>;

/** A share-flow preview answer: the recognised game and its dry run, or a refusal. */
export type SharePreviewAnswer =
  | ({ kind: "preview" } & SharePreview)
  | { kind: "rejected"; reason: ScoreInputRejection };

/** `POST /v1/games/score-preview` — the share flow: text with no game chosen yet. */
export async function previewSharedScore(
  body: { scoreRaw: string; periodKey: string },
  token: string | null,
  signal?: AbortSignal,
): Promise<SharePreviewAnswer | null> {
  try {
    const raw = await apiRequest<unknown>({
      method: "POST",
      path: "/v1/games/score-preview",
      body,
      token,
      ...(signal ? { signal } : {}),
    });
    const parsed = sharePreviewSchema.safeParse(raw);
    return parsed.success ? { kind: "preview", ...parsed.data } : null;
  } catch (error) {
    const reason = scoreInputRejection(error);
    if (reason) return { kind: "rejected", reason };
    throw error;
  }
}

const candidatesSchema = z.object({
  candidates: z.array(featureSchema),
  roles: z.record(z.string(), z.enum(SCORE_FEATURE_ROLES)),
  scoreId: z.string().nullable(),
  labelled: z.boolean(),
});

export interface CandidateLabels {
  roles: Record<string, ScoreFeatureRole>;
  scoreId: string | null;
}

/**
 * `POST /v1/games/:id/scores/candidates` — role labels for the picker's
 * chips and the one to pre-select. Null when the labels did not arrive (the
 * model was slow or down): the chips simply stay unlabelled.
 */
export async function fetchCandidateLabels(
  gameId: string,
  scoreRaw: string,
  token: string | null,
  signal?: AbortSignal,
): Promise<CandidateLabels | null> {
  const raw = await apiRequest<unknown>({
    method: "POST",
    path: `/v1/games/${gameId}/scores/candidates`,
    body: { scoreRaw },
    token,
    ...(signal ? { signal } : {}),
  });
  const parsed = candidatesSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.labelled) return null;
  return { roles: parsed.data.roles, scoreId: parsed.data.scoreId };
}

/** `POST /v1/games/:id/scores/:periodKey/pick` — "Fix score" on your own row. */
export function applyScorePick(
  gameId: string,
  periodKey: string,
  body: { pick: ScorePick; overrodeRole?: ScoreFeatureRole },
  token: string | null,
): Promise<ApplyScorePickResponse> {
  return apiRequest<ApplyScorePickResponse>({
    method: "POST",
    path: `/v1/games/${gameId}/scores/${periodKey}/pick`,
    body,
    token,
  });
}

/**
 * `POST /v1/games/:id/parser/teach` — teach the game's parser from your own
 * picked score for that day. Always resolves with an outcome; the pick has
 * already fixed your score whatever it is.
 */
export function teachParser(
  gameId: string,
  body: { periodKey: string; scoreDirection?: GameScoreDirection },
  token: string | null,
): Promise<TeachParserResponse> {
  return apiRequest<TeachParserResponse>({
    method: "POST",
    path: `/v1/games/${gameId}/parser/teach`,
    body,
    token,
  });
}

/** `PUT /v1/games/:id/score-direction` — from the game's "…" menu. */
export function setScoreDirection(
  gameId: string,
  scoreDirection: GameScoreDirection,
  token: string | null,
): Promise<SetScoreDirectionResponse> {
  return apiRequest<SetScoreDirectionResponse>({
    method: "PUT",
    path: `/v1/games/${gameId}/score-direction`,
    body: { scoreDirection },
    token,
  });
}
