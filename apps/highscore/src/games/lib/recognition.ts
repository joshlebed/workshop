// Pure helpers for the server-side game recognition hint (see
// `api/recognition.ts`). Recognition names any game with stored scores,
// including ones a user added; the registry regexes in
// `shareScoreDetection.ts` remain the detection for everyone without the
// capability and the fallback whenever recognition has no answer.

import type { RecognizedGameMatch } from "../api/recognition";
import type { ShareGameTarget } from "./shareScoreDetection";

// Catalog titles are page <title>s: "Geozee — Daily Geography Category
// Puzzle". The name is the first segment.
const TITLE_SEPARATORS = /\s*[|·—–:]\s*|\s+-\s+/;

/** The short name to show for a recognized game. */
export function recognizedGameLabel(match: RecognizedGameMatch): string {
  return match.game.title.split(TITLE_SEPARATORS)[0]?.trim() || match.game.title;
}

/**
 * Where a recognized score posts from the share flow. A catalog game that
 * isn't in My Games yet goes by URL, like a registry detection does: posting
 * find-or-creates it and the card says it will be added.
 */
export function recognizedGameTarget(match: RecognizedGameMatch): ShareGameTarget {
  return {
    gameId: match.inMyGames ? match.game.id : null,
    title: recognizedGameLabel(match),
    url: match.game.url,
  };
}

/**
 * The recognized game, when it is a DIFFERENT game from the one being posted
 * to — the only case worth interrupting for. Recognizing the same game, or
 * nothing at all, is not a reason to say anything: a game with one stored
 * score often can't be recognized yet, and that must not read as a warning.
 */
export function wrongGameMatch(
  match: RecognizedGameMatch | null,
  postingToGameId: string | null | undefined,
): RecognizedGameMatch | null {
  if (!match || !postingToGameId) return null;
  return match.game.id === postingToGameId ? null : match;
}
