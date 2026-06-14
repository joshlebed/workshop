// The game registry — single source of truth for every known daily game:
// identity (how to recognize the game from an item/url), detection (how to
// recognize its pasted share text), parsing (the score spec), direction, and
// display (how to distill a share into the compact block leaderboards and
// clipboard recaps show).
//
// This replaces three hand-synced catalogs: the backend's GAME_REGEX_CATALOG
// (apps/backend/src/lib/gameScoreRegex.ts), the client's GAME_PATTERNS
// (shareScoreDetection.ts) and the client's per-game FORMATTERS
// (scoresSummary.ts). Adding a game is now one entry here (+ a seed migration
// row when `catalog: true` — games.test.ts enforces the sync).
//
// Pure runtime module exported via the `./gameRegistry` subpath (like
// `./constants` / `./games`): Metro can't resolve the barrel's `.js`
// re-exports, so the client imports this file directly. Runtime imports from
// sibling shared modules are avoided for the same reason — only type imports
// (which Metro elides) are safe.

import type { GameScoreDirection } from "./games.js";
import type { ScoreSpec } from "./scoreParsing.js";

// Detection order matters: more specific games come first so e.g. "Worldle"
// doesn't fall through to a looser Wordle match — keep "wordle" last.
export const GAME_KEYS = [
  "anthropeum",
  "maptap",
  "dailytens",
  "satle",
  "travle",
  "globle",
  "worldle",
  "tradle",
  "geosports",
  "framed",
  "heardle",
  "connections",
  "strands",
  "nyt-mini",
  "spelling-bee",
  "wordle",
] as const;

export type GameKey = (typeof GAME_KEYS)[number];

export interface GameDefinition {
  key: GameKey;
  /** Canonical catalog title (what the games table stores). */
  title: string;
  /** Display label for share-detection UI when it differs from `title`. */
  gameLabel?: string;
  /** Must normalize (via `normalizeGameUrl`) to the games-table dedup key. */
  canonicalUrl: string;
  /**
   * True = seeded into the global `games` catalog with `game_key` set, so the
   * backend parses scores via `spec`. False = detection/display only (the
   * backend treats such games as unknown).
   */
  catalog: boolean;
  /** 'desc' = bigger is better, 'asc' = lower is better. */
  scoreDirection: GameScoreDirection;
  /** How to parse a numeric score out of a share; null = no reliable parse. */
  spec: ScoreSpec | null;
  /** Any one matching an item/game's title/url/siteName/sourceId identifies it. */
  identifyPatterns: RegExp[];
  /** Any one matching a pasted share text identifies the game. */
  shareTextPatterns: RegExp[];
  /**
   * Distill the raw share into the compact block shown under a leaderboard
   * row / recap bullet. Return null to defer to `formatShareBodyFallback`.
   */
  formatShareBody?: (raw: string) => string | null;
}

// ---------------------------------------------------------------------------
// Formatter helpers
// ---------------------------------------------------------------------------

const URL_RE = /\bhttps?:\/\/\S+/gi;

// A Globle grid's final line ends `= N`. Players sometimes hand-append a marker
// after it — real prod shares carry `= 13(cheated)` (a manual, non-genuine-score
// callout people add before sharing anyway). It's freeform human text, so match
// `= N` plus whatever trails it to end-of-line rather than a fixed `(cheated)`
// shape; that keeps the grid-block trimming from falling through to the raw
// date/avg header, while the marker stays on the score line so the recap shows
// the score was flagged.
const GRID_SCORE_TAIL = /=\s*\d+.*$/;

function stripUrlSubstrings(text: string): string {
  return text.replace(URL_RE, "");
}

function nonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * A "grid-only" line carries only emoji / box-drawing / checkmarks plus an
 * optional `= N` suffix — i.e. no readable English text. Used by per-game
 * formatters to pick the visual grid block out of the raw share.
 */
function isGridOnlyLine(line: string): boolean {
  return !/[A-Za-z0-9]/.test(line.replace(GRID_SCORE_TAIL, ""));
}

const KEYCAP_DIGITS = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];

function toKeycapDigits(text: string): string {
  return text.replace(/\d/g, (d) => KEYCAP_DIGITS[Number(d)]!);
}

/**
 * Fallback formatter for games without a specific heuristic: strip embedded
 * URLs, drop pure-hashtag lines (`#globle`, `#dailygame`) and blank lines,
 * and otherwise preserve the raw text — including leading whitespace, which
 * some games use to align grids. Returns `null` if nothing's left worth
 * showing.
 */
export function formatShareBodyFallback(raw: string): string | null {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(URL_RE, "").trimEnd())
    .filter((l) => l.trim().length > 0)
    .filter((l) => !/^\s*#\S+\s*$/.test(l));
  return lines.length ? lines.join("\n") : null;
}

/**
 * True when a shared payload carries no postable result — i.e. after removing
 * URLs and pure-hashtag/blank lines, nothing is left. The canonical case is a
 * game whose iOS share hands our extension only its referral link (e.g.
 * `https://dailytens.com/?ref=944415`) with the 🏆/❌ grid silently dropped at
 * the share-sheet boundary. Mirrors the strip rules in `formatShareBodyFallback`
 * so "what we'd refuse to post" matches "what would render as nothing".
 */
export function isResultlessShare(raw: string | null | undefined): boolean {
  const text = raw?.trim() ?? "";
  if (!text) return true;
  return formatShareBodyFallback(text) === null;
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export const GAME_REGISTRY: GameDefinition[] = [
  {
    key: "anthropeum",
    title: "Anthropeum",
    canonicalUrl: "https://anthropeum.com",
    catalog: true,
    scoreDirection: "desc",
    // "62,090 · top 38% of players today!" → 62090 (points; higher is better).
    // The header line's `·` ("Anthropeum.com · Jun 14 2026") has no digits in
    // front of it, so the first `[\d,]+ ·` the capture lands on is the score.
    spec: { rules: [{ kind: "capture", pattern: "([\\d,]+(?:\\.\\d+)?)\\s*·" }] },
    identifyPatterns: [/\banthropeum\b/i, /anthropeum\.com/i],
    shareTextPatterns: [/\banthropeum\.com\b/i, /\banthropeum\b/i],
    // Shape: `Anthropeum.com · Jun 14 2026\n🟨🟨🟨🟨🟩🟦🟩🟥🟦🟩\n62,090 · top 38% of players today!`
    // Drop the url/date header line (it also catches a trailing `anthropeum.com`
    // link) and collapse the emoji grid + score line into one clean line.
    formatShareBody(raw) {
      const lines = nonEmptyLines(raw).filter((l) => !/anthropeum\.com/i.test(l));
      return lines.length ? lines.join(" ") : null;
    },
  },
  {
    key: "maptap",
    title: "MapTap",
    canonicalUrl: "https://maptap.gg",
    catalog: true,
    scoreDirection: "desc",
    // "Final score: 970" → 970
    spec: { rules: [{ kind: "capture", pattern: "Final score:\\s*(\\d+)" }] },
    identifyPatterns: [/\bmap\s*tap\b/i, /maptap\.gg/i],
    shareTextPatterns: [/\bmaptap\.gg\b/i, /\bmap\s*tap\b/i],
    // Shape: `www.maptap.gg May 27\n100🎯 95🏆 94🏅 52😔 77😂\nFinal score: 770`
    // Drop the URL/date header line; keep the per-round scoreline and the
    // Final score line verbatim.
    formatShareBody(raw) {
      const lines = nonEmptyLines(stripUrlSubstrings(raw)).filter(
        (l) => !/^(?:www\.)?maptap\.gg\b/i.test(l),
      );
      return lines.length ? lines.join("\n") : null;
    },
  },
  {
    key: "dailytens",
    title: "Daily Tens",
    canonicalUrl: "https://dailytens.com",
    catalog: true,
    scoreDirection: "desc",
    // The share is a 5×2 grid of 🏆 (correct) / ❌ (wrong) for the day's 10
    // questions; score = number of 🏆. `within` keeps a gridless share (just
    // the `?ref=` URL, the grid dropped at the share-sheet boundary) at null
    // instead of a fake 0, while an all-❌ day still scores a legitimate 0.
    spec: { rules: [{ kind: "count", token: "🏆", within: "[🏆❌]" }] },
    identifyPatterns: [/\bdaily\s*tens\b/i, /dailytens\.com/i],
    shareTextPatterns: [/\bdaily\s*tens\b\s*#?\d+/i, /\bdailytens\.com\b/i],
    // Shape: `DailyTens #751\n\n     🏆    ❌\n     🏆    🏆\n...` — a 5-row ×
    // 2-col 🏆/❌ grid. Drop the `DailyTens #N` header (the `• Daily Tens`
    // bullet already labels the block) and the column-aligning whitespace,
    // then **transpose** the grid to two rows of five: the left column
    // (top→bottom) becomes the first row, the right column the second. 6 lines
    // collapse to 2. Require at least one grid line so a URL-only share
    // doesn't slip through with just the dailytens.com ref.
    formatShareBody(raw) {
      const cellRows = raw
        .split(/\r?\n/)
        .map((l) => [...l.replace(URL_RE, "").matchAll(/[🏆❌]/gu)].map((m) => m[0]))
        .filter((cells) => cells.length > 0);
      if (cellRows.length === 0) return null;
      const width = cellRows[0]!.length;
      // Only transpose a well-formed rectangular grid; otherwise defer to fallback.
      if (width === 0 || cellRows.some((r) => r.length !== width)) return null;
      const rows: string[] = [];
      for (let c = 0; c < width; c++) {
        rows.push(cellRows.map((r) => r[c]).join(""));
      }
      return rows.join("\n");
    },
  },
  {
    key: "satle",
    title: "Satle",
    canonicalUrl: "https://satle.ca",
    catalog: true,
    scoreDirection: "asc",
    // "Satle #449 5/6" → 5
    spec: { rules: [{ kind: "capture", pattern: "Satle\\s*#\\d+\\s+(\\d+)/6" }] },
    identifyPatterns: [/\bsatle\b/i, /satle\.ca/i],
    shareTextPatterns: [/\bsatle\s*#\s*\d+/i, /\bsatle\.ca\b/i],
    // Shape: `🛰Satle #468 6/6\n🟥🟥🟥🟥🟥🟩\nhttps://satle.ca`
    // Pull the `N/6` fraction off the header and append it to the grid.
    formatShareBody(raw) {
      const lines = nonEmptyLines(stripUrlSubstrings(raw));
      const header = lines.find((l) => /satle/i.test(l));
      const grid = lines.find((l) => isGridOnlyLine(l) && !/satle/i.test(l));
      const fraction = header?.match(/(\d+|X)\/\d+/i)?.[0];
      if (!grid || !fraction) return null;
      return `${grid} ${fraction}`;
    },
  },
  {
    key: "travle",
    title: "Travle",
    gameLabel: "travle",
    canonicalUrl: "https://travle.earth",
    catalog: true,
    scoreDirection: "asc",
    // "#travle #1250 +0" → 0 (extra-guess count; lower is better)
    spec: { rules: [{ kind: "capture", pattern: "#travle\\s+#?\\d+\\s+\\+(\\d+)" }] },
    identifyPatterns: [/\btravle\b/i, /travle\.earth/i],
    shareTextPatterns: [/#travle\s+#?\d+/i, /\btravle\.earth\b/i],
    // Shape: `#travle #1260 +2\n🟧✅🟩🟧🟩✅✅\nhttps://travle.earth`
    // (perfect: `#travle #1251 +0 (Perfect)`)
    // Pull the `+N` (with optional parenthetical) off the header and append.
    formatShareBody(raw) {
      const lines = nonEmptyLines(stripUrlSubstrings(raw));
      const header = lines.find((l) => /travle/i.test(l));
      const grid = lines.find((l) => isGridOnlyLine(l) && !/travle/i.test(l));
      const score = header?.match(/[+-]\d+(?:\s*\([^)]+\))?/)?.[0];
      if (!grid || !score) return null;
      return `${grid} ${score}`;
    },
  },
  {
    key: "globle",
    title: "Globle",
    canonicalUrl: "https://globle-game.com",
    catalog: true,
    scoreDirection: "asc",
    // "⬜⬜🟧🟥🟩 = 5" → 5 (today's guess count; lower is better). No `$`
    // anchor — the share text has a trailing URL + hashtag. There's only one
    // `=` in the canonical Globle share, so this is safe.
    spec: { rules: [{ kind: "capture", pattern: "=\\s*(\\d+)" }] },
    identifyPatterns: [/\bgloble\b/i, /globle-game\.com/i],
    shareTextPatterns: [/#globle\b/i, /\bgloble-game\.com\b/i],
    // Shape: `🌎 May 27, 2026 🌍\n🔥 1 | Avg. Guesses: 8.4\n⬜🟨⬜🟧🟩 = 5\n\nhttps://globle-game.com\n#globle`
    // Long runs wrap across multiple grid lines; the final line ends `= N`,
    // with an optional hand-typed marker like `(cheated)` after it (see
    // GRID_SCORE_TAIL).
    formatShareBody(raw) {
      const lines = nonEmptyLines(stripUrlSubstrings(raw));
      const gridStart = lines.findIndex(isGridOnlyLine);
      if (gridStart === -1) return null;
      let gridEnd = -1;
      for (let i = gridStart; i < lines.length; i++) {
        if (GRID_SCORE_TAIL.test(lines[i]!)) {
          gridEnd = i;
          break;
        }
      }
      if (gridEnd === -1) return null;
      return lines.slice(gridStart, gridEnd + 1).join("\n");
    },
  },
  {
    key: "worldle",
    title: "Worldle",
    canonicalUrl: "https://worldle.teuteuf.fr",
    catalog: true,
    scoreDirection: "asc",
    // "#Worldle #842 3/6 (100%)" → 3
    spec: { rules: [{ kind: "capture", pattern: "Worldle\\s*#?\\d+\\s+(\\d+)/6" }] },
    identifyPatterns: [/\bworldle\b/i, /worldle\.teuteuf\.fr/i],
    shareTextPatterns: [/#?\bWorldle\b\s*#?\d+/i, /\bworldle\.teuteuf\.fr\b/i],
  },
  {
    key: "tradle",
    title: "Tradle",
    canonicalUrl: "https://tradle.net",
    catalog: true,
    scoreDirection: "asc",
    // "#Tradle #1547 1/6" → 1 (guess count out of 6; lower is better)
    spec: { rules: [{ kind: "capture", pattern: "Tradle\\s*#?\\d+\\s+(\\d+)/6" }] },
    // Tradle now lives at tradle.net; oec.world kept for legacy bookmarks.
    identifyPatterns: [/\btradle\b/i, /tradle\.net/i, /oec\.world.*tradle/i],
    shareTextPatterns: [/#?\bTradle\b\s*#?\d+/i, /\btradle\.net\b/i, /\boec\.world\/.+\/tradle\b/i],
    // Shape: `#Tradle #1548 6/6\n🟩🟩⬜⬜⬜\n🟩🟩🟩⬜⬜\n…\n🟩🟩🟩🟩🟩\nhttps://tradle.net/`
    // The grid's signal is "how many greens per guess until you nailed it", so
    // collapse each guess row to its 🟩 count into a single sparkline and
    // suffix the `N/6` (or `X/6`) fraction from the header —
    // `🟩 2·3·4·4·4·5 6/6`. Six grid lines collapse to one. Require at least
    // one grid line so a URL-only share defers to the fallback.
    formatShareBody(raw) {
      const lines = nonEmptyLines(stripUrlSubstrings(raw));
      const greens = lines
        .filter((l) => isGridOnlyLine(l) && /[🟩🟨🟧🟥⬜]/u.test(l))
        .map((l) => (l.match(/🟩/gu) ?? []).length);
      if (greens.length === 0) return null;
      const fraction = lines.find((l) => /tradle/i.test(l))?.match(/(?:\d+|X)\/\d+/i)?.[0];
      const sparkline = `🟩 ${greens.join("·")}`;
      return fraction ? `${sparkline} ${fraction}` : sparkline;
    },
  },
  {
    key: "geosports",
    title: "GeoSports",
    canonicalUrl: "https://www.geosports.app",
    catalog: true,
    scoreDirection: "desc",
    // "711 / 1,000" → 711 (points scored; higher is better). Commas are
    // stripped by the capture rule before Number().
    spec: { rules: [{ kind: "capture", pattern: "([\\d,]+)\\s*/\\s*[\\d,]+" }] },
    identifyPatterns: [/\bgeosports\b/i, /geosports\.app/i],
    shareTextPatterns: [/\bgeosports\b/i, /geosports\.app/i],
    // Shape: `GeoSports — Daily sports geography game\nGeoSports · June 11th\n🟡🟡🔴🟡🟢\n711 / 1,000\nwww.geosports.app`
    // Keep the emoji grid row and the "N / 1,000" score line; drop the header
    // lines and the URL (already stripped).
    formatShareBody(raw) {
      const lines = nonEmptyLines(stripUrlSubstrings(raw));
      const grid = lines.find(isGridOnlyLine);
      const score = lines.find((l) => /[\d,]+\s*\/\s*[\d,]+/.test(l));
      if (!grid || !score) return null;
      return `${grid}\n${score}`;
    },
  },
  {
    key: "framed",
    title: "Framed",
    canonicalUrl: "https://framed.wtf",
    catalog: true,
    scoreDirection: "asc",
    // Shape: `Framed #1234\n🎥 🟥 🟥 🟩 ⬛ ⬛ ⬛` — the guess count is the
    // position of 🟩 among the squares (🟥 wrong guesses before it, ⬛/⬜
    // unused after); no 🟩 = a loss = no numeric score. The old regex grabbed
    // the puzzle number, which is identical for everyone that day and tied the
    // whole board — same bug Daily Tens had before `count`.
    spec: { rules: [{ kind: "tokenPosition", token: "🟩", among: ["🟥", "⬛", "⬜"] }] },
    identifyPatterns: [/\bframed\b/i, /framed\.wtf/i],
    shareTextPatterns: [/\bFramed\s*#\d+/i, /\bframed\.wtf\b/i],
  },
  {
    key: "heardle",
    title: "Heardle",
    canonicalUrl: "https://www.heardle.app",
    catalog: false,
    scoreDirection: "asc",
    spec: null,
    identifyPatterns: [/\bheardle\b/i],
    shareTextPatterns: [/#Heardle\b\s*#?\d+/i, /\bheardle\.app\b/i, /\bheardle\.glitch\.me\b/i],
  },
  {
    key: "connections",
    title: "Connections",
    canonicalUrl: "https://www.nytimes.com/games/connections",
    catalog: true,
    scoreDirection: "asc",
    // The share is one line of four color squares per guess; a perfect game is
    // 4 rows, each mistake adds one (max 7). Count the guess rows; no grid at
    // all = no result.
    spec: { rules: [{ kind: "countLines", pattern: "^[🟨🟩🟦🟪]{4}$" }] },
    identifyPatterns: [/\bconnections\b/i, /nytimes\.com\/games\/connections/i],
    shareTextPatterns: [
      // The official NYT share starts with "Connections\nPuzzle #<n>".
      /\bConnections\b[\s\S]{0,40}Puzzle\s*#?\d+/i,
      /nytimes\.com\/games\/connections/i,
    ],
    // Drop the "Connections" / "Puzzle #N" header lines; the grid speaks for
    // itself under the game-title bullet.
    formatShareBody(raw) {
      const lines = nonEmptyLines(stripUrlSubstrings(raw)).filter(
        (l) => !/^Connections$/i.test(l) && !/^Puzzle\s*#?\d+$/i.test(l),
      );
      return lines.length ? lines.join("\n") : null;
    },
  },
  {
    key: "strands",
    title: "Strands",
    canonicalUrl: "https://www.nytimes.com/games/strands",
    catalog: true,
    scoreDirection: "asc",
    // The share grid is 🔵 (found word) / 🟡 (spangram) / 💡 (hint used);
    // score = hints used, 0 is a perfect game. `within` keeps a gridless
    // share at null while a hint-free grid still scores a legitimate 0.
    spec: { rules: [{ kind: "count", token: "💡", within: "[💡🔵🟡]" }] },
    identifyPatterns: [/\bstrands\b/i, /nytimes\.com\/games\/strands/i],
    shareTextPatterns: [
      /\bStrands\s*#\d+/i,
      // Share blocks always start with "Strands #N\n"Today's theme""
      /\bStrands\b[\s\S]{0,40}Today.?s theme/i,
      /nytimes\.com\/games\/strands/i,
    ],
  },
  {
    key: "nyt-mini",
    title: "NYT Mini",
    canonicalUrl: "https://www.nytimes.com/crosswords/game/mini",
    catalog: true,
    scoreDirection: "asc",
    // "I solved the 5/20/2026 New York Times Mini Crossword in 0:16!" → 16
    // seconds. The date is a fraction-shaped trap for naive number parsing —
    // the duration rule only reads `m:ss`.
    spec: { rules: [{ kind: "duration" }] },
    identifyPatterns: [
      /\bmini\s*crossword\b/i,
      /\bnyt\s*mini\b/i,
      /\bthe mini\b/i,
      /nytimes\.com\/(?:badges|crosswords\/game)\/mini/i,
    ],
    shareTextPatterns: [
      /nytimes\.com\/(?:badges|crosswords\/game)\/mini/i,
      /\bThe Mini\b[\s\S]{0,40}\d+:\d{2}/i,
      /\bMini Crossword\b[\s\S]{0,20}\d+:\d{2}/i,
    ],
    // Shape: `I solved the 5/20/2026 New York Times Mini Crossword in 0:16!`
    // No grid — render the `M:SS` solve time as keycap-emoji digits so the
    // bullet has a visual analogue to the grids the other games emit.
    formatShareBody(raw) {
      const time = stripUrlSubstrings(raw).match(/\b\d+:\d{2}\b/)?.[0];
      return time ? toKeycapDigits(time) : null;
    },
  },
  {
    key: "spelling-bee",
    title: "Spelling Bee",
    canonicalUrl: "https://www.nytimes.com/puzzles/spelling-bee",
    catalog: true,
    scoreDirection: "desc",
    // The NYT share is rank-based ("I just hit Genius on Spelling Bee."); map
    // the rank word to its ordinal so the board can order players.
    spec: {
      rules: [
        {
          kind: "wordMap",
          pattern: "(?:hit|reached|got to|made it to)\\s+([A-Za-z ]{2,20}?)\\s+on",
          map: {
            beginner: 1,
            "good start": 2,
            "moving up": 3,
            good: 4,
            solid: 5,
            nice: 6,
            great: 7,
            amazing: 8,
            genius: 9,
            "queen bee": 10,
          },
        },
      ],
    },
    identifyPatterns: [/\bspelling\s*bee\b/i, /nytimes\.com\/puzzles\/spelling-bee/i],
    shareTextPatterns: [
      /\bSpelling Bee\b/i,
      /nytimes\.com\/puzzles\/spelling-bee/i,
      // The NYT Spelling Bee share is "I just hit <rank> on Spelling Bee."
      /\bhit\s+\w+\s+on\s+Spelling Bee\b/i,
    ],
  },
  {
    key: "wordle",
    title: "Wordle",
    canonicalUrl: "https://www.nytimes.com/games/wordle",
    catalog: true,
    scoreDirection: "asc",
    // "Wordle 1,127 3/6" → 3 (guess count out of 6; lower is better). The
    // [\d,] swallows the puzzle number's thousands separator without
    // capturing it.
    spec: { rules: [{ kind: "capture", pattern: "Wordle\\s+[\\d,]+\\s+(\\d+)/6" }] },
    identifyPatterns: [/\bwordle\b/i, /nytimes\.com\/games\/wordle/i],
    // Keep this entry last — "Wordle" is short and could appear as a substring
    // elsewhere; require the number-of-guesses suffix to be safe.
    shareTextPatterns: [/\bWordle\b\s+[\d,]+\s+[\dX]\/6/i, /nytimes\.com\/games\/wordle/i],
  },
];

/** Registry entries seeded into the global `games` catalog (game_key set). */
export const CATALOG_GAME_DEFINITIONS: GameDefinition[] = GAME_REGISTRY.filter((g) => g.catalog);

const BY_KEY = new Map(GAME_REGISTRY.map((g) => [g.key as string, g]));

/** Look up a registry entry by its stable key (e.g. a games.game_key value). */
export function gameDefinitionForKey(key: string | null | undefined): GameDefinition | null {
  if (!key) return null;
  return BY_KEY.get(key) ?? null;
}

/** The label share-detection UI shows for a game. */
export function gameLabelFor(def: GameDefinition): string {
  return def.gameLabel ?? def.title;
}

/**
 * Identify a known game from identity text (item/game title, url, siteName,
 * sourceId, …). Conservative: at least one `identifyPattern` must match.
 * `catalogOnly` restricts to catalog entries — the backend's self-heal path
 * uses it so detection-only games (Heardle) stay unmapped, like today.
 */
export function identifyGame(
  values: ReadonlyArray<string | null | undefined>,
  opts: { catalogOnly?: boolean } = {},
): GameDefinition | null {
  const haystack = values.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  if (haystack.length === 0) return null;
  for (const def of GAME_REGISTRY) {
    if (opts.catalogOnly && !def.catalog) continue;
    for (const pattern of def.identifyPatterns) {
      if (haystack.some((h) => pattern.test(h))) return def;
    }
  }
  return null;
}

/** Identify a game from a pasted share text. Registry order = priority. */
export function matchShareText(text: string): GameDefinition | null {
  for (const def of GAME_REGISTRY) {
    if (def.shareTextPatterns.some((re) => re.test(text))) return def;
  }
  return null;
}
