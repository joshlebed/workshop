// The score rail is one monospace column running from the top of the ledger
// down through any open board, so everything in it has to be short. This is
// the single rule for what a row is allowed to put there.
//
// Press Start 2P is fixed-advance, but emoji render roughly double width, so
// the budget is measured in cells rather than characters — six red squares
// and "5/6" is nine characters and sixteen cells.

import type { Game } from "@workshop/shared/games";
import { summarizeGameScoreBody } from "../games/lib/scoresSummary";

/** Cells a value may occupy in the 56px BEST / YOU columns at pixel 10–12. */
export const RAIL_CELLS = 5;

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

export function railCells(text: string): number {
  let cells = 0;
  for (const ch of text) cells += PICTOGRAPHIC.test(ch) ? 2 : 1;
  return cells;
}

export interface RailEntry {
  scoreValue: number | null;
  scoreRaw: string | null;
}

/**
 * A distilled result if it fits the given budget (`4/6`, `+0`, `🟥🟥🟩 3/6`),
 * otherwise the number the backend parsed out of it (`988`), otherwise null —
 * callers show a lit "played" square for null rather than an ellipsis.
 */
export function compactScore(
  game: Pick<Game, "title" | "url" | "summarySpec">,
  entry: RailEntry,
  cells: number = RAIL_CELLS,
): string | null {
  const body = summarizeGameScoreBody(game, entry);
  const line = body?.split("\n")[0]?.trim();
  if (body && line && body.split("\n").length === 1 && railCells(line) <= cells) return line;
  if (entry.scoreValue !== null && Number.isFinite(entry.scoreValue)) {
    return String(entry.scoreValue);
  }
  return null;
}

export function railScore(
  game: Pick<Game, "title" | "url" | "summarySpec">,
  entry: RailEntry,
): string | null {
  return compactScore(game, entry, RAIL_CELLS);
}

/** True when `railScore` already says everything the body has to say. */
export function railSaysItAll(
  game: Pick<Game, "title" | "url" | "summarySpec">,
  entry: RailEntry,
): boolean {
  const body = summarizeGameScoreBody(game, entry);
  const line = body?.split("\n")[0]?.trim();
  return !!body && !!line && body.split("\n").length === 1 && railCells(line) <= RAIL_CELLS;
}
