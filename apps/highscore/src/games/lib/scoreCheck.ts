// Teach v2's "what will this post record" states and their copy (spec:
// docs/highscore-score-validation-spec.md, "States and copy"). Pure — the
// hook (`useScoreCheck`) gathers the inputs, this decides what is shown, and
// the paste sheet, the game board and the share card all render the result.

import type { ScoreInputRejection } from "@workshop/shared/games";
import type { ScoreFeatureRole } from "@workshop/shared/scoreCandidates";
import type { PreviewAnswer } from "../api/teach";
import { formatGameDateLabel } from "./gameDate";

export type ScoreCheckView =
  /** Nothing to say: no text yet. */
  | { kind: "none" }
  /** The preview is in flight and still inside the short wait. */
  | { kind: "checking" }
  /** The preview is late or failed — the user posts without it. */
  | { kind: "no_preview" }
  /** The text is only a link or a title: nothing to post yet. */
  | { kind: "no_result_text"; copy: string }
  /** The text positively matches another game; the user chooses where it goes. */
  | { kind: "wrong_game"; copy: string; otherGameId: string; otherTitle: string }
  | { kind: "score"; copy: string }
  | { kind: "no_result"; copy: string }
  | { kind: "unread"; copy: string };

export const SCORE_COPY = {
  noResult: "No score today. This posts and ranks last.",
  unread: "Couldn't read a score. Post now or tap yours:",
  noResultText: "We got the link but not your result. Paste your result to post a score.",
  notRight: "Not right?",
  didNotFinish: "I didn't finish",
  checking: "Checking…",
  pickAnother: "Pick another",
  useAnyway: "Use it anyway",
  fixScore: "Fix score",
  adjusted: "adjusted",
} as const;

/** "Score: 944", or "Score: 7 (counted 🏆)" for a computed value. */
export function scoreReadCopy(value: number, derivation: string | null): string {
  return derivation ? `Score: ${value} (${derivation})` : `Score: ${value}`;
}

export function wrongGameCopy(otherTitle: string): string {
  return `This looks like a ${otherTitle} score.`;
}

/** "This is the same result you posted yesterday. Post anyway?" */
export function sameTextCopy(otherDay: string, today: string): string {
  const label = formatGameDateLabel(otherDay, today);
  const when = label === "Yesterday" || label === "Today" ? label.toLowerCase() : `on ${label}`;
  return `This is the same result you posted ${when}. Post anyway?`;
}

const ROLE_NOUN: Partial<Record<ScoreFeatureRole, string>> = {
  puzzle_number: "the puzzle number",
  date: "part of the date",
  streak: "your streak",
  percentile: "a ranking",
};

/** Short tag under a chip the labels say is not the score. */
export const ROLE_TAG: Partial<Record<ScoreFeatureRole, string>> = {
  puzzle_number: "puzzle #",
  date: "date",
  streak: "streak",
  percentile: "ranking",
};

/**
 * "That looks like the puzzle number. Use it anyway?" — null when the label
 * gives no reason to ask (it is the score, or nothing in particular).
 */
export function roleMismatchCopy(role: ScoreFeatureRole | undefined): string | null {
  const noun = role ? ROLE_NOUN[role] : undefined;
  return noun ? `That looks like ${noun}. Use it anyway?` : null;
}

function rejectedView(reason: ScoreInputRejection): ScoreCheckView {
  // Link-only and title-only are the same thing to the player: the share
  // sheet handed over the page, not the result.
  if (reason === "url_only" || reason === "title_only") {
    return { kind: "no_result_text", copy: SCORE_COPY.noResultText };
  }
  if (reason === "future_day") {
    return { kind: "no_result_text", copy: "That day hasn't happened yet." };
  }
  if (reason === "too_long") {
    return {
      kind: "no_result_text",
      copy: "That's too long to be a result. Paste just the score.",
    };
  }
  return { kind: "none" };
}

/**
 * Which state the score box is in. Order matters: nothing to post beats
 * everything; a wrong-game match is settled before the reading is shown
 * (the reading is of the wrong game's text); then what the parser made of it.
 */
export function resolveScoreCheck(input: {
  empty: boolean;
  /** The server's answer for the text on screen; undefined while it is out. */
  answer: PreviewAnswer | null | undefined;
  /** The short wait for the preview has run out. */
  waitedOut: boolean;
  /** The user chose "Post here anyway". */
  wrongGameDismissed: boolean;
  /**
   * The games list already says this game has no parser. Nothing can read its
   * texts, so there is nothing to wait for: the picker's state is known the
   * moment there is text, whatever the network is doing.
   */
  knownUntaught?: boolean;
}): ScoreCheckView {
  if (input.empty) return { kind: "none" };
  if (input.answer === undefined) {
    if (input.knownUntaught) return { kind: "unread", copy: SCORE_COPY.unread };
    return input.waitedOut ? { kind: "no_preview" } : { kind: "checking" };
  }
  if (input.answer === null) return { kind: "no_preview" };
  if (input.answer.kind === "rejected") return rejectedView(input.answer.reason);

  const { preview } = input.answer;
  const other = preview.teach?.wrongGame;
  if (other && !input.wrongGameDismissed) {
    return {
      kind: "wrong_game",
      copy: wrongGameCopy(other.game.title),
      otherGameId: other.game.id,
      otherTitle: other.game.title,
    };
  }
  if (preview.parseStatus === "score" && preview.scoreValue !== null) {
    return {
      kind: "score",
      copy: scoreReadCopy(preview.scoreValue, preview.teach?.derivation ?? null),
    };
  }
  if (preview.parseStatus === "no_result") return { kind: "no_result", copy: SCORE_COPY.noResult };
  return { kind: "unread", copy: SCORE_COPY.unread };
}

/**
 * The line that states a row's score in words ("Score: 270"), or null when
 * the row needs none.
 *
 * - A picked row always says it: the text on the row may not show the number
 *   at all (a count, a pick the parser disagrees with).
 * - In a game with no formatter every read row says it, however the row came
 *   to be read (at upload, by the re-read after a teach, by the one-off
 *   re-read). Without a formatter a row's text is only the cleaned share, so
 *   two rows of one board must not differ by who happened to pick.
 * - In a game with a formatter the row's text already is the score.
 *
 * `everyRow` is the account's teach capability: without it only picked rows
 * get the line, as before.
 */
export function scoreLineLabel(
  entry: {
    scoreSource?: string | undefined;
    parseStatus?: string | undefined;
    scoreValue: number | null;
  },
  game: { hasFormatter?: boolean | undefined },
  everyRow: boolean,
): string | null {
  if (entry.scoreSource === "picked") {
    if (entry.parseStatus === "no_result") return "Didn't finish";
    return entry.scoreValue === null ? null : `Score: ${entry.scoreValue}`;
  }
  if (!everyRow || game.hasFormatter !== false) return null;
  if (entry.parseStatus === "no_result") return "No score";
  if (entry.parseStatus !== "score" || entry.scoreValue === null) return null;
  return `Score: ${entry.scoreValue}`;
}

/** Only invalid input blocks posting. Detection and parsing are advisory. */
export function blocksPosting(view: ScoreCheckView): boolean {
  return view.kind === "no_result_text";
}
