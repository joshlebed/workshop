import type {
  GameScoreDirection,
  ScoreTeachHint,
  TeachParserResponse,
} from "@workshop/shared/games";
import { teachParser } from "../api/teach";

/** Asks the user which way a game ranks. `suggested` is only what to offer first. */
export type AskDirection = (suggested: GameScoreDirection | null) => Promise<GameScoreDirection>;

/**
 * After a pick was stored: teach the game's parser from it when the server
 * says the pick can (`teach.eligible`). Runs after the post has already
 * succeeded — the caller does not wait on it to close the sheet — and never
 * throws: a teach that fails leaves the game as it was and the score saved.
 *
 * A first teach also sets which way scores rank, and that is always the
 * user's call: the direction they confirmed in the picker, or — when the
 * picker never got to ask (it did not know the game had no parser) — the
 * answer to `askDirection` now. The server's suggestion is never sent as if
 * the user had chosen it.
 */
export async function teachAfterPost(input: {
  gameId: string;
  periodKey: string;
  hint: ScoreTeachHint | undefined;
  /** What the user confirmed in the picker, if it asked. */
  scoreDirection: GameScoreDirection | null;
  askDirection: AskDirection;
  token: string | null;
}): Promise<TeachParserResponse | null> {
  if (!input.hint?.eligible) return null;
  try {
    const direction = input.hint.needsDirection
      ? (input.scoreDirection ?? (await input.askDirection(input.hint.suggestedDirection)))
      : null;
    return await teachParser(
      input.gameId,
      { periodKey: input.periodKey, ...(direction ? { scoreDirection: direction } : {}) },
      input.token,
    );
  } catch {
    return null;
  }
}

/** The toast for a teach outcome, or null when there is nothing worth saying. */
export function teachOutcomeMessage(
  result: TeachParserResponse | null,
  gameTitle: string,
): string | null {
  switch (result?.outcome) {
    case "accepted":
    case "switched":
      return `Got it. ${gameTitle} scores will be read this way from now on.`;
    case "conflict":
      return `Your score is saved. Someone else reads ${gameTitle} differently, so the game stays as it is for now.`;
    default:
      // Rejected, unavailable, not needed: the user's own score is already right.
      return null;
  }
}
