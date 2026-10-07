// Client-side score-spec resolution — mirrors the backend's parser chain
// (lib/gameCatalog.ts `specForGame`) so the paste sheet can preview exactly
// what the server will record. Lives here, not in @workshop/shared: shared
// runtime modules can't value-import each other under Metro (the `.js`
// specifier problem), but app code can import both subpaths.

import type { Item } from "@workshop/shared";
import { gameDefinitionForKey } from "@workshop/shared/gameRegistry";
import type { GameScorePreview } from "@workshop/shared/games";
import {
  evaluateScoreSpec,
  parseFirstNumber,
  type ScoreSpec,
  safeParseScoreSpec,
} from "@workshop/shared/scoreParsing";
import { detectGameKindForItem } from "./shareScoreDetection";

/** Registry spec (by game_key) → user-taught `games.score_spec` → null. */
export function specForGame(game: {
  gameKey: string | null;
  scoreSpec?: unknown;
}): ScoreSpec | null {
  const def = gameDefinitionForKey(game.gameKey);
  if (def?.catalog && def.spec) return def.spec;
  return safeParseScoreSpec(game.scoreSpec ?? null);
}

/**
 * Whether a game's scoring can be (re-)taught at all. Mirrors the backend's
 * `catalogEntryForKey` gate on `PUT /v1/games/:id/score-spec`: registry catalog
 * games are read-only (their specs live in code — you can't re-teach Wordle),
 * everything else (user-taught or first-number-fallback games) is teachable.
 * Whether a *re*-teach is allowed is a separate, admin-gated concern; this only
 * answers "is this game eligible for the teach UI at all".
 */
export function isGameReteachable(game: { gameKey: string | null }): boolean {
  return !gameDefinitionForKey(game.gameKey)?.catalog;
}

/**
 * Best-effort spec for a Lists-surface item: the registry entry its
 * title/url/metadata identify. Items don't carry their stored rule over the
 * API, so non-registry games preview through the first-number fallback.
 */
export function specForItem(item: Item): ScoreSpec | null {
  const def = gameDefinitionForKey(detectGameKindForItem(item));
  return def?.catalog ? def.spec : null;
}

export interface ScorePreview {
  /** What the server will record (mirrors the upsert's parser chain). */
  value: number | null;
  /** True when a real spec produced the value (vs the first-number guess). */
  fromSpec: boolean;
}

/** Mirror of the backend's `parseScoreValue` resolution, for previews. */
export function previewScore(raw: string, spec: ScoreSpec | null): ScorePreview {
  if (spec) {
    const result = evaluateScoreSpec(spec, raw);
    if (result.hadValidRule) return { value: result.value, fromSpec: true };
  }
  return { value: parseFirstNumber(raw), fromSpec: false };
}

/**
 * The one-line "what will this post record" caption under the paste input.
 * `server` is the server's dry run (present only for accounts whose scores
 * are parsed by stored game code); `local` is the client-side mirror of the
 * legacy parser. The server's answer wins when there is one: it is what the
 * post will actually store, and it can tell a loss from an unread share.
 */
export function scorePreviewCaption(
  server: GameScorePreview | null,
  local: ScorePreview | null,
): string | null {
  if (server) {
    if (server.parseStatus === "score" && server.scoreValue !== null) {
      return `Recording score: ${server.scoreValue}`;
    }
    // A loss ranks last; a share the game's code could not read has no rank.
    return server.parseStatus === "no_result"
      ? "No score today. This posts and ranks last."
      : "Couldn't read a score in this. It'll post without a rank.";
  }
  if (!local) return null;
  return local.value !== null
    ? `Recording score: ${local.value}`
    : "Couldn't read a score in this. It'll post as “Played”.";
}
