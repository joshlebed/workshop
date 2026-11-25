// Recognizing a share's game on the device, minus React: the recognizers the
// server derived for this account are kept in the device cache, and steps
// 1–3 of recognition (`@workshop/shared/gameRecognition` — the same code the
// server runs) are applied to them the moment a text arrives. That answers
// ~99% of real shares with no request (eval: apps/backend/scripts/
// eval-game-recognition.ts --no-jev). Whatever this cannot place, the server
// still is asked about, and only the server reads the score.
//
// The hook (`useGameRecognizers`) adds the query and the storage calls;
// everything that decides behaviour is here and tested without a renderer.

import {
  type GameRecognizer,
  RECOGNITION_SURFACE_THRESHOLD,
  recognizeWithRecognizers,
} from "@workshop/shared/gameRecognition";
import { isResultlessShare } from "@workshop/shared/gameRegistry";
import type { GameRecognitionMethod, GamesResponse } from "@workshop/shared/games";
import { z } from "zod";
import type { RecognizedGameMatch } from "../api/recognition";

/** One recognizer as it crosses the wire and sits in the device cache. */
export const gameRecognizerSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  normalizedUrl: z.string(),
  examples: z.number(),
  fingerprint: z.record(z.string(), z.number()).nullable(),
  hosts: z.array(z.string()),
}) satisfies z.ZodType<GameRecognizer>;

/** The one device-cache entry: the signed-in account's recognizers. */
export const RECOGNIZER_CACHE_KEY = "games.recognizers";
// Bump when `GameRecognizer` or the way it is used changes shape: an entry
// written by other code is dropped, not migrated.
const CACHE_VERSION = 1;
/**
 * A stored set older than this is not used. Recognizers go stale slowly (a
 * game's share layout, the player's game list), and every app open refreshes
 * them — this only bounds a device that has not opened the app in weeks.
 */
const MAX_AGE_MS = 30 * 24 * 60 * 60_000;

const storedSchema = z.object({
  v: z.literal(CACHE_VERSION),
  userId: z.string(),
  savedAt: z.number(),
  recognizers: z.array(gameRecognizerSchema),
});

export interface StoredRecognizers {
  savedAt: number;
  recognizers: GameRecognizer[];
}

export function serializeRecognizers(
  userId: string,
  recognizers: readonly GameRecognizer[],
  now: number,
): string {
  return JSON.stringify({ v: CACHE_VERSION, userId, savedAt: now, recognizers });
}

/**
 * The stored recognizers, when they are this account's, this version's and
 * recent enough. Anything else — nothing stored, another account's, a
 * corrupt or outdated entry — is null.
 */
export function parseStoredRecognizers(
  raw: string | null,
  userId: string,
  now: number,
): StoredRecognizers | null {
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = storedSchema.safeParse(json);
  if (!parsed.success || parsed.data.userId !== userId) return null;
  const age = now - parsed.data.savedAt;
  if (age < 0 || age > MAX_AGE_MS) return null;
  return { savedAt: parsed.data.savedAt, recognizers: parsed.data.recognizers };
}

/**
 * Whether the server has recognition on for this account: true / false once a
 * `GET /v1/games` response has said so, null before any has arrived (a cold
 * start into the share flow). Stored recognizers are used while it is
 * unknown — they were only ever handed out with the capability on — and
 * dropped once it is known to be off.
 */
export function recognitionCapability(
  responses: ReadonlyArray<GamesResponse | undefined>,
): boolean | null {
  const loaded = responses.filter((r): r is GamesResponse => r !== undefined);
  if (loaded.length === 0) return null;
  return loaded.some((r) => r.capabilities?.recognition === true);
}

/** A match made on this device: same shape as the server's, minus the classifier. */
export type LocalGameMatch = RecognizedGameMatch & {
  method: Exclude<GameRecognitionMethod, "jev">;
};

/**
 * The game this device recognizes `text` as a score for, or null — when it
 * has no recognizers, when the text is only a game's link, and when steps
 * 1–3 cannot say (the caller then asks the server).
 *
 * `myGameIds` is the live My Games list when it has loaded; it decides
 * `inMyGames` on the answer, so a game added since the recognizers were
 * built posts straight to its row.
 */
export function recognizeLocally(
  text: string,
  recognizers: readonly GameRecognizer[] | null,
  myGameIds: ReadonlySet<string> | null,
): LocalGameMatch | null {
  if (!recognizers || recognizers.length === 0) return null;
  const trimmed = text.trim();
  if (!trimmed || isResultlessShare(trimmed)) return null;
  const result = recognizeWithRecognizers(trimmed, recognizers);
  if (!result || result.confidence < RECOGNITION_SURFACE_THRESHOLD) return null;
  // The classifier only runs on the server; this narrows the type.
  if (result.method === "jev") return null;
  const game = recognizers.find((r) => r.id === result.gameId);
  if (!game) return null;
  return {
    game: { id: game.id, title: game.title, url: game.url },
    // Recognizers are My Games as of when they were built.
    inMyGames: myGameIds ? myGameIds.has(game.id) : true,
    confidence: result.confidence,
    method: result.method,
  };
}

/**
 * True when the recognizers were built for a different My Games list than
 * the one on screen — a game was added or removed since — so they should be
 * fetched again now rather than when they next go stale.
 */
export function recognizersOutOfDate(
  recognizers: readonly GameRecognizer[],
  myGameIds: ReadonlySet<string>,
): boolean {
  const known = new Set(recognizers.map((r) => r.id));
  if (known.size !== myGameIds.size) return true;
  for (const id of myGameIds) if (!known.has(id)) return true;
  return false;
}
