// The edge-input gate (spec §7): score texts the server refuses before any
// stored code runs. Everything else — junk, a hand-typed "gave up", a note
// after the result — is allowed through and simply reads as it reads.

import { isResultlessShare } from "@workshop/shared/gameRegistry";
import type { ScoreInputRejection } from "@workshop/shared/games";
import { shiftPeriodKey } from "@workshop/shared/games";
import { labelsForGame, type RecognitionCandidate } from "../gameRecognition.js";

/** The existing limit on a score text. */
const MAX_SCORE_RAW_CHARS = 2000;

const URL_RE = /\bhttps?:\/\/\S+/gi;
// A real share carries a number or an emoji; a page title does not.
const RESULT_LIKE = /\p{N}|\p{Extended_Pictographic}/u;
// Page titles read "<name> - <tagline>" / "<name> | <tagline>".
const TITLE_SEPARATORS = /\s*[|·—–:]\s*|\s+-\s+/;

function joinedWords(text: string): string {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join("");
}

/**
 * True when the text is nothing but a game's name or page title — what a
 * share sheet hands over when it passes the page instead of the result
 * ("MapTap.gg - Daily Geography Game"). The name must be the whole first
 * segment: "Tradle failed" is a player's own note, not a title.
 */
export function isTitleOnlyShare(raw: string, games: readonly RecognitionCandidate[]): boolean {
  const lines = raw
    .replace(URL_RE, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const [line] = lines;
  if (lines.length !== 1 || line === undefined || RESULT_LIKE.test(line)) return false;
  const head = line.split(TITLE_SEPARATORS)[0] ?? "";
  const name = joinedWords(head);
  if (!name) return false;
  // "MapTap.gg" as a head is the site itself.
  const asHost = head.toLowerCase().replace(/^www\./, "");
  return games.some((game) => {
    const host = game.normalizedUrl.toLowerCase().split("/")[0];
    return asHost === host || labelsForGame(game).includes(name);
  });
}

/**
 * Why this score text may not be posted, or null when it may. `games` are
 * the games whose title would make a title-only text (the target game, or the
 * caller's candidates when no game is chosen yet). `today` is the server's
 * UTC day; a client ahead of UTC may legitimately be on the next one.
 */
export function checkScoreInput(input: {
  raw: string;
  periodKey: string;
  today: string;
  games: readonly RecognitionCandidate[];
}): ScoreInputRejection | null {
  const { raw } = input;
  if (raw.trim().length === 0) return "empty";
  if (raw.length > MAX_SCORE_RAW_CHARS) return "too_long";
  if (input.periodKey > shiftPeriodKey(input.today, 1)) return "future_day";
  if (isResultlessShare(raw)) return "url_only";
  if (isTitleOnlyShare(raw, input.games)) return "title_only";
  return null;
}
