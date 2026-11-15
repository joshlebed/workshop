// `GET /v1/games/recognizers`: the per-game recognition evidence this device
// keeps so the share flow can name a game without a request. 404s unless
// `capabilities.recognition` is on for the account, so check that first.

import { apiRequest } from "@workshop/api-client/api";
import type { GameRecognizer } from "@workshop/shared/gameRecognition";
import { z } from "zod";
import { gameRecognizerSchema } from "../lib/localRecognition";

const responseSchema = z.object({ recognizers: z.array(gameRecognizerSchema) });

/**
 * The caller's recognizers, or null when the response isn't the shape we
 * expect — a detection hint must never be the thing that breaks posting.
 */
export async function fetchGameRecognizers(
  token: string | null,
  signal?: AbortSignal,
): Promise<GameRecognizer[] | null> {
  const raw = await apiRequest<unknown>({
    method: "GET",
    path: "/v1/games/recognizers",
    token,
    ...(signal ? { signal } : {}),
  });
  const parsed = responseSchema.safeParse(raw);
  return parsed.success ? parsed.data.recognizers : null;
}
