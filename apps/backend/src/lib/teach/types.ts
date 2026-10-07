// Types shared by the teach engine's pure parts (alteration, acceptance,
// prompt building) and the DB layer that feeds them.

import type { ScoreFeature } from "@workshop/shared/scoreCandidates";

/** What a user picked, as stored on their score row (`game_scores.pick`). */
export type StoredPick = { kind: "feature"; feature: ScoreFeature } | { kind: "no_result" };

/** The value a pick stands for: a number, or null for "I didn't finish". */
export function pickValue(pick: StoredPick): number | null {
  return pick.kind === "feature" ? pick.feature.value : null;
}

/** One stored score inside the acceptance window. */
export interface WindowScore {
  userId: string;
  periodKey: string;
  raw: string;
  /**
   * What the parser made of it: a `score`, a `no_result` (a loss), `failed`
   * (unread), or null — a row written before code-based parsing, whose
   * `value` is whatever the legacy parser produced.
   */
  status: "score" | "no_result" | "failed" | null;
  value: number | null;
  source: "parsed" | "picked";
  /** `games.code_version` when the row was parsed; null on a row from before code parsing. */
  codeVersion: number | null;
  /** Present when `source` is `picked`. */
  pick: StoredPick | null;
  /**
   * A confirmed training example: a pick on a text that positively matches
   * the game by label or URL. Other picks only fix their own row.
   */
  isExample: boolean;
}

/** The acceptance gates, in the order they are applied. */
export type AcceptanceGate =
  | "sandbox_limit"
  | "alteration_test"
  | "reproduction"
  | "changes_other_read_scores";
