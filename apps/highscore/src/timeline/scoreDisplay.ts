// Splitting a pasted result into the two things a leaderboard actually needs.
//
// A daily-game share is an emoji picture plus a number ("🟩🟩🟨⬜ = 8",
// "3/6", "Final score: 990"). Rendered as one blob it wraps, truncates and
// buries the number — which is the whole point of a leaderboard. So every row
// gets two fields instead:
//
//   value  the score, set in the pixel face and right-aligned so a column of
//          them lines up (Press Start 2P is effectively monospace)
//   strip  everything else, collapsed to a single clipped line of glyphs
//
// `scoreValue` from the server is the last-resort value: it is definitionally
// the number the ranking used, so it can never disagree with the rank beside it.

import type { GameStandingsEntry } from "@workshop/shared/games";
import { summarizeGameScoreBody } from "../games/lib/scoresSummary";

export interface ScoreDisplay {
  /** The headline number, e.g. "3/6", "990", "+0". Null when there isn't one. */
  value: string | null;
  /** One-line glyph remainder. Null when the whole result was the value. */
  strip: string | null;
}

// Ordered by how explicit the game is being about which number is the score.
const VALUE_PATTERNS: RegExp[] = [
  /final score:\s*(-?\d+)/i,
  /\b(\d+\/\d+)\b/,
  /=\s*(-?\d+)/,
  /(?:^|\s)([+-]\d+)(?=\s|$)/,
];

export function scoreDisplay(
  game: Parameters<typeof summarizeGameScoreBody>[0],
  entry: Pick<GameStandingsEntry, "scoreRaw" | "scoreValue">,
): ScoreDisplay {
  const body = stripShareHeader(summarizeGameScoreBody(game, entry), game.title);
  if (!body) {
    const fallback = entry.scoreValue;
    return {
      value: fallback != null && Number.isFinite(fallback) ? String(fallback) : null,
      strip: null,
    };
  }

  for (const pattern of VALUE_PATTERNS) {
    const match = body.match(pattern);
    const captured = match?.[1];
    if (match && captured) {
      const strip = collapse(
        body.slice(0, match.index).concat(body.slice(match.index! + match[0].length)),
      );
      return { value: captured, strip: strip || null };
    }
  }

  const fallback = entry.scoreValue;
  return {
    value: fallback != null && Number.isFinite(fallback) ? String(fallback) : null,
    strip: collapse(body) || null,
  };
}

/**
 * Most shares open with "MapTap #123" — the game restating its own name and a
 * puzzle number. Both are already on screen (the row is under that game's
 * header), so they only push the actual result out of the column.
 */
function stripShareHeader(body: string | null, title: string): string | null {
  if (!body) return body;
  const firstWord = title.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const kept = body
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (firstWord && trimmed.toLowerCase().startsWith(firstWord)) return false;
      return true;
    })
    .join("\n")
    .replace(/#\d+/g, "");
  return kept.trim() || body;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
