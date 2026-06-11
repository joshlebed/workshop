// Client-side score-spec resolution — mirrors the backend's parser chain
// (lib/gameCatalog.ts `specForGame`) so the paste sheet can preview exactly
// what the server will record. Lives here, not in @workshop/shared: shared
// runtime modules can't value-import each other under Metro (the `.js`
// specifier problem), but app code can import both subpaths.

import type { Item } from "@workshop/shared";
import { gameDefinitionForKey } from "@workshop/shared/gameRegistry";
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
