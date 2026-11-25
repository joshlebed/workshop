// "What to play next" (spike 5) — the client's rules, pure so they are
// unit-tested: the reason line under each row, and when each surface shows
// the rail. Ranking and the content gate live on the server
// (`apps/backend/src/lib/gameSuggestions.ts`); the client never re-ranks.

import type { GameSuggestionReason } from "@workshop/shared/games";

/** Rows each surface shows, at most. The board never shows more than 3. */
export const SUGGESTION_ROWS = { board: 3, home: 5, post_accept: 8 } as const;

/** The line under a suggested game's title. */
export function suggestionReasonLine(reason: GameSuggestionReason): string {
  switch (reason.kind) {
    case "coplay":
      return reason.players === 1
        ? `A ${reason.withGameTitle} player plays this`
        : `${reason.players} ${reason.withGameTitle} players play this`;
    case "friends_of_friends":
      return reason.players === 1
        ? "Played by a friend of a friend this week"
        : `Played by ${reason.players} friends of friends this week`;
    case "popular":
      return "Popular on HighScore";
  }
}

/**
 * Board: right after a score — the viewer has posted a score this session
 * (any surface) and has a score on this board for today. Hidden on past days
 * and once dismissed this session.
 */
export function boardRailVisible(input: {
  scorePostedThisSession: boolean;
  viewerScoredOnBoard: boolean;
  viewingToday: boolean;
  dismissed: boolean;
}): boolean {
  return (
    input.scorePostedThisSession &&
    input.viewerScoredOnBoard &&
    input.viewingToday &&
    !input.dismissed
  );
}

/**
 * Home: below the cards while the viewer has 1–2 games. `latched` keeps it up
 * for the rest of the session once shown, so adding the third game from the
 * rail doesn't yank it away mid-tap. Hidden once dismissed this session.
 */
export function homeRailVisible(input: {
  gameCount: number;
  latched: boolean;
  dismissed: boolean;
}): boolean {
  if (input.dismissed || input.gameCount === 0) return false;
  return input.latched || input.gameCount <= 2;
}
