/**
 * Catalog of per-game `score_regex` + `score_direction` values for known
 * leaderboard games, plus a matcher that identifies a game from an item's
 * title / url / siteName / sourceId.
 *
 * Used in two places:
 * - `scripts/backfill-score-regex.ts` replays this across existing items +
 *   their historical scores.
 * - The score upsert path (`routes/v1/scores.ts`) self-heals an item the
 *   first time a score is posted to it, so a leaderboard game created after
 *   the one-time backfill still parses correctly instead of falling back to
 *   "first number anywhere in the text" — which grabs the date, the puzzle
 *   number, or (for Daily Tens) the `dailytens.com/?ref=<id>` referral id.
 *
 * To add a game, append an entry here and the upsert path picks it up
 * automatically; re-run the backfill to fix existing rows.
 */

type ScoreDirection = "asc" | "desc";

interface GameScoreRegex {
  key: string;
  // Match against any of: item title, item url, content.siteName, content.sourceId.
  identifyPatterns: RegExp[];
  // JS regex source (no flags — backend applies `i`) with capture group 1
  // around the numeric score. A string so it can be stored verbatim on
  // items.score_regex.
  scoreRegex: string;
  // 'desc' = bigger is better, 'asc' = lower is better.
  scoreDirection: ScoreDirection;
}

export const GAME_REGEX_CATALOG: GameScoreRegex[] = [
  {
    key: "maptap",
    identifyPatterns: [/\bmap\s*tap\b/i, /maptap\.gg/i],
    // "Final score: 970" → 970
    scoreRegex: "Final score:\\s*(\\d+)",
    scoreDirection: "desc",
  },
  {
    key: "globle",
    identifyPatterns: [/\bgloble\b/i, /globle-game\.com/i],
    // "⬜⬜🟧🟥🟩 = 5" → 5 (today's guess count; lower is better). No `$`
    // anchor — the backend applies the regex with only `i`, so `$` would
    // require end-of-string (the share text has trailing URL + hashtag).
    // There's only one `=` in the canonical Globle share, so this is safe.
    scoreRegex: "=\\s*(\\d+)",
    scoreDirection: "asc",
  },
  {
    key: "satle",
    identifyPatterns: [/\bsatle\b/i, /satle\.ca/i],
    // "Satle #449 5/6" → 5
    scoreRegex: "Satle\\s*#\\d+\\s+(\\d+)/6",
    scoreDirection: "asc",
  },
  {
    key: "travle",
    identifyPatterns: [/\btravle\b/i, /travle\.earth/i],
    // "#travle #1250 +0" → 0 (extra-guess count; lower is better)
    scoreRegex: "#travle\\s+#?\\d+\\s+\\+(\\d+)",
    scoreDirection: "asc",
  },
  {
    key: "wordle",
    identifyPatterns: [/\bwordle\b/i, /nytimes\.com\/games\/wordle/i],
    // "Wordle 1,127 3/6" → 3 (guess count out of 6; lower is better). The
    // [\d,] swallows the puzzle number's thousands separator without
    // capturing it.
    scoreRegex: "Wordle\\s+[\\d,]+\\s+(\\d+)/6",
    scoreDirection: "asc",
  },
  {
    key: "worldle",
    identifyPatterns: [/\bworldle\b/i, /worldle\.teuteuf\.fr/i],
    // "#Worldle #842 3/6 (100%)" → 3
    scoreRegex: "Worldle\\s*#?\\d+\\s+(\\d+)/6",
    scoreDirection: "asc",
  },
  {
    key: "tradle",
    // Tradle now lives at tradle.net; oec.world kept for legacy bookmarks.
    identifyPatterns: [/\btradle\b/i, /tradle\.net/i, /oec\.world.*tradle/i],
    // "#Tradle #1547 1/6" → 1 (guess count out of 6; lower is better)
    scoreRegex: "Tradle\\s*#?\\d+\\s+(\\d+)/6",
    scoreDirection: "asc",
  },
  {
    key: "framed",
    identifyPatterns: [/\bframed\b/i, /framed\.wtf/i],
    // No explicit numeric score in the share — the squares encode guesses.
    // Count the gray boxes by treating the trailing run of squares as the
    // attempt count: we just grab the puzzle number for now so the column
    // is set; ranking still works since everyone uses the same scale per day.
    // Override manually if we want a stricter ordering later.
    scoreRegex: "Framed\\s+#(\\d+)",
    scoreDirection: "desc",
  },
  {
    key: "dailytens",
    identifyPatterns: [/\bdaily\s*tens\b/i, /dailytens\.com/i],
    // "DailyTens #751" → 751. The share is a 🏆/❌ grid with no numeric
    // score; we capture the puzzle number so score_value is anchored to the
    // share itself instead of the trailing `dailytens.com/?ref=<6-digit-id>`
    // URL param (which the "first number anywhere" fallback used to grab).
    // Everyone shares the same puzzle per day, so this ties all players —
    // acceptable until we add real trophy-count ranking.
    scoreRegex: "DailyTens\\s*#(\\d+)",
    scoreDirection: "desc",
  },
];

interface GameIdentifyFields {
  title?: string | null;
  url?: string | null;
  siteName?: string | null;
  sourceId?: string | null;
}

/**
 * Identify a known game from an item's searchable fields, returning its
 * catalog entry (regex + direction) or null. Conservative: an item must match
 * at least one `identifyPattern`.
 */
export function matchGameScoreRegex(fields: GameIdentifyFields): GameScoreRegex | null {
  const haystack = [fields.title, fields.url, fields.siteName, fields.sourceId].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  for (const game of GAME_REGEX_CATALOG) {
    for (const pat of game.identifyPatterns) {
      if (haystack.some((h) => pat.test(h))) return game;
    }
  }
  return null;
}
