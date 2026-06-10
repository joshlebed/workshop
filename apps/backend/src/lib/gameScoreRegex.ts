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

/**
 * Sentinel prefix for a "count" score: a `score_regex` of `count:<pattern>`
 * means the score is the *number of global matches* of `<pattern>` in the
 * share, not a captured number. Used by games whose share is a tally of marker
 * emoji with no numeric score (Daily Tens: score = number of 🏆). Kept here so
 * the catalog, the upsert parser (`tryParseScoreValue`), and the backfill
 * (`parseScore`) all agree on the spelling.
 */
export const SCORE_COUNT_PREFIX = "count:";

interface GameScoreRegex {
  key: string;
  // Canonical display metadata for the global `games` catalog (spec §3.3).
  // `canonicalUrl` must normalize (via `normalizeGameUrl`) to the key the
  // games table dedupes on; the migration seed and the find-or-create path
  // both derive from these.
  title: string;
  canonicalUrl: string;
  // Match against any of: item title, item url, content.siteName, content.sourceId.
  identifyPatterns: RegExp[];
  // How to pull the score out of a pasted share, stored verbatim on
  // `items.score_regex`. Two forms:
  //  - a JS regex source (no flags — backend applies `i`) with capture group 1
  //    around the numeric score; or
  //  - `${SCORE_COUNT_PREFIX}<pattern>` → the score is the count of global
  //    matches of `<pattern>` (e.g. Daily Tens counts 🏆).
  scoreRegex: string;
  // 'desc' = bigger is better, 'asc' = lower is better.
  scoreDirection: ScoreDirection;
}

export const GAME_REGEX_CATALOG: GameScoreRegex[] = [
  {
    key: "maptap",
    title: "MapTap",
    canonicalUrl: "https://maptap.gg",
    identifyPatterns: [/\bmap\s*tap\b/i, /maptap\.gg/i],
    // "Final score: 970" → 970
    scoreRegex: "Final score:\\s*(\\d+)",
    scoreDirection: "desc",
  },
  {
    key: "globle",
    title: "Globle",
    canonicalUrl: "https://globle-game.com",
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
    title: "Satle",
    canonicalUrl: "https://satle.ca",
    identifyPatterns: [/\bsatle\b/i, /satle\.ca/i],
    // "Satle #449 5/6" → 5
    scoreRegex: "Satle\\s*#\\d+\\s+(\\d+)/6",
    scoreDirection: "asc",
  },
  {
    key: "travle",
    title: "Travle",
    canonicalUrl: "https://travle.earth",
    identifyPatterns: [/\btravle\b/i, /travle\.earth/i],
    // "#travle #1250 +0" → 0 (extra-guess count; lower is better)
    scoreRegex: "#travle\\s+#?\\d+\\s+\\+(\\d+)",
    scoreDirection: "asc",
  },
  {
    key: "wordle",
    title: "Wordle",
    canonicalUrl: "https://www.nytimes.com/games/wordle",
    identifyPatterns: [/\bwordle\b/i, /nytimes\.com\/games\/wordle/i],
    // "Wordle 1,127 3/6" → 3 (guess count out of 6; lower is better). The
    // [\d,] swallows the puzzle number's thousands separator without
    // capturing it.
    scoreRegex: "Wordle\\s+[\\d,]+\\s+(\\d+)/6",
    scoreDirection: "asc",
  },
  {
    key: "worldle",
    title: "Worldle",
    canonicalUrl: "https://worldle.teuteuf.fr",
    identifyPatterns: [/\bworldle\b/i, /worldle\.teuteuf\.fr/i],
    // "#Worldle #842 3/6 (100%)" → 3
    scoreRegex: "Worldle\\s*#?\\d+\\s+(\\d+)/6",
    scoreDirection: "asc",
  },
  {
    key: "tradle",
    title: "Tradle",
    canonicalUrl: "https://tradle.net",
    // Tradle now lives at tradle.net; oec.world kept for legacy bookmarks.
    identifyPatterns: [/\btradle\b/i, /tradle\.net/i, /oec\.world.*tradle/i],
    // "#Tradle #1547 1/6" → 1 (guess count out of 6; lower is better)
    scoreRegex: "Tradle\\s*#?\\d+\\s+(\\d+)/6",
    scoreDirection: "asc",
  },
  {
    key: "framed",
    title: "Framed",
    canonicalUrl: "https://framed.wtf",
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
    title: "Daily Tens",
    canonicalUrl: "https://dailytens.com",
    identifyPatterns: [/\bdaily\s*tens\b/i, /dailytens\.com/i],
    // The share is a 5×2 grid of 🏆 (correct) / ❌ (wrong) for the day's 10
    // questions. Score = number of 🏆 (more is better). `count:🏆` counts the
    // trophies rather than capturing a number — the old "DailyTens #(\\d+)"
    // grabbed the puzzle number, which is identical for everyone that day and
    // tied the whole leaderboard. A gridless share (just the `?ref=` URL) has
    // no 🏆 → counts 0; the client's `isResultlessShare` guard blocks those.
    scoreRegex: `${SCORE_COUNT_PREFIX}🏆`,
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
