// Game-score recognition (`POST /v1/games/recognize`): which game is this
// pasted text a score for? Only callable when the server says so —
// `capabilities.recognition` on `GET /v1/games` — and the endpoint 404s
// otherwise, so check `useRecognitionAvailable` before calling.

import { apiRequest } from "@workshop/api-client/api";
import { z } from "zod";

const recognizedGameSchema = z.object({
  game: z.object({ id: z.string(), title: z.string(), url: z.string() }),
  inMyGames: z.boolean(),
  confidence: z.number(),
  method: z.string(),
});

const recognizeGameResponseSchema = z.object({ match: recognizedGameSchema.nullable() });

/** The slice of the server's `RecognizedGame` this client uses. */
export type RecognizedGameMatch = z.infer<typeof recognizedGameSchema>;

/**
 * Ask the server which game `text` is a score for. Null when it isn't sure
 * enough to say — or when the response isn't the shape we expect, since a
 * detection hint must never be the thing that breaks posting.
 */
export async function recognizeGame(
  text: string,
  token: string | null,
  signal?: AbortSignal,
): Promise<RecognizedGameMatch | null> {
  const raw = await apiRequest<unknown>({
    method: "POST",
    path: "/v1/games/recognize",
    body: { text },
    token,
    ...(signal ? { signal } : {}),
  });
  const parsed = recognizeGameResponseSchema.safeParse(raw);
  return parsed.success ? parsed.data.match : null;
}
