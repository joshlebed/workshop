import type { Item, ListItemsResponse, ListSummary } from "@workshop/shared";

export type DetectedSharedScoreKind =
  | "maptap"
  | "dailytens"
  | "globle"
  | "satle"
  | "travle"
  | "wordle"
  | "connections"
  | "strands"
  | "worldle"
  | "tradle"
  | "framed"
  | "heardle"
  | "nyt-mini"
  | "spelling-bee";

export interface DetectedSharedScore {
  kind: DetectedSharedScoreKind;
  gameLabel: string;
  scoreRaw: string;
  source: "regex";
}

export interface ShareScoreTarget {
  list: ListSummary;
  item: Item;
}

interface GamePattern {
  kind: DetectedSharedScoreKind;
  gameLabel: string;
  // Any one of these matching the shared text identifies the game.
  textPatterns: RegExp[];
  // Any one of these matching an item's searchable text (title/url/siteName/
  // sourceId) marks that item as the leaderboard target for this kind.
  itemPatterns: RegExp[];
}

// Order matters: more specific games come first so e.g. "Worldle" doesn't
// fall through to a looser Wordle match.
const GAME_PATTERNS: GamePattern[] = [
  {
    kind: "maptap",
    gameLabel: "MapTap",
    textPatterns: [/\bmaptap\.gg\b/i, /\bmap\s*tap\b/i],
    itemPatterns: [/\bmap\s*tap\b/i, /maptap\.gg/i],
  },
  {
    kind: "dailytens",
    gameLabel: "Daily Tens",
    textPatterns: [/\bdaily\s*tens\b\s*#?\d+/i, /\bdailytens\.com\b/i],
    itemPatterns: [/\bdaily\s*tens\b/i, /dailytens\.com/i],
  },
  {
    kind: "satle",
    gameLabel: "Satle",
    textPatterns: [/\bsatle\s*#\s*\d+/i, /\bsatle\.ca\b/i],
    itemPatterns: [/\bsatle\b/i, /satle\.ca/i],
  },
  {
    kind: "travle",
    gameLabel: "travle",
    textPatterns: [/#travle\s+#?\d+/i, /\btravle\.earth\b/i],
    itemPatterns: [/\btravle\b/i, /travle\.earth/i],
  },
  {
    kind: "globle",
    gameLabel: "Globle",
    textPatterns: [/#globle\b/i, /\bgloble-game\.com\b/i],
    itemPatterns: [/\bgloble\b/i, /globle-game\.com/i],
  },
  {
    kind: "worldle",
    gameLabel: "Worldle",
    textPatterns: [/#?\bWorldle\b\s*#?\d+/i, /\bworldle\.teuteuf\.fr\b/i],
    itemPatterns: [/\bworldle\b/i, /worldle\.teuteuf\.fr/i],
  },
  {
    kind: "tradle",
    gameLabel: "Tradle",
    // Tradle moved from oec.world/<lang>/tradle to its own tradle.net domain;
    // keep the legacy oec.world pattern for any old bookmarks already saved.
    textPatterns: [/#?\bTradle\b\s*#?\d+/i, /\btradle\.net\b/i, /\boec\.world\/.+\/tradle\b/i],
    itemPatterns: [/\btradle\b/i, /tradle\.net/i, /oec\.world.*tradle/i],
  },
  {
    kind: "framed",
    gameLabel: "Framed",
    textPatterns: [/\bFramed\s*#\d+/i, /\bframed\.wtf\b/i],
    itemPatterns: [/\bframed\b/i, /framed\.wtf/i],
  },
  {
    kind: "heardle",
    gameLabel: "Heardle",
    textPatterns: [/#Heardle\b\s*#?\d+/i, /\bheardle\.app\b/i, /\bheardle\.glitch\.me\b/i],
    itemPatterns: [/\bheardle\b/i],
  },
  {
    kind: "connections",
    gameLabel: "Connections",
    textPatterns: [
      // The official NYT share starts with "Connections\nPuzzle #<n>".
      /\bConnections\b[\s\S]{0,40}Puzzle\s*#?\d+/i,
      /nytimes\.com\/games\/connections/i,
    ],
    itemPatterns: [/\bconnections\b/i, /nytimes\.com\/games\/connections/i],
  },
  {
    kind: "strands",
    gameLabel: "Strands",
    textPatterns: [
      /\bStrands\s*#\d+/i,
      // Share blocks always start with "Strands #N\n"Today's theme""
      /\bStrands\b[\s\S]{0,40}Today.?s theme/i,
      /nytimes\.com\/games\/strands/i,
    ],
    itemPatterns: [/\bstrands\b/i, /nytimes\.com\/games\/strands/i],
  },
  {
    kind: "nyt-mini",
    gameLabel: "NYT Mini",
    textPatterns: [
      /nytimes\.com\/(?:badges|crosswords\/game)\/mini/i,
      /\bThe Mini\b[\s\S]{0,40}\d+:\d{2}/i,
    ],
    itemPatterns: [/\bmini\s*crossword\b/i, /\bnyt\s*mini\b/i, /\bthe mini\b/i],
  },
  {
    kind: "spelling-bee",
    gameLabel: "Spelling Bee",
    textPatterns: [
      /\bSpelling Bee\b/i,
      /nytimes\.com\/puzzles\/spelling-bee/i,
      // The NYT Spelling Bee share is "I just hit <rank> on Spelling Bee."
      /\bhit\s+\w+\s+on\s+Spelling Bee\b/i,
    ],
    itemPatterns: [/\bspelling\s*bee\b/i, /nytimes\.com\/puzzles\/spelling-bee/i],
  },
  {
    kind: "wordle",
    gameLabel: "Wordle",
    // Keep this near the bottom — "Wordle" is short and could appear as a
    // substring elsewhere; require the number-of-guesses suffix to be safe.
    textPatterns: [/\bWordle\b\s+[\d,]+\s+[\dX]\/6/i, /nytimes\.com\/games\/wordle/i],
    itemPatterns: [/\bwordle\b/i, /nytimes\.com\/games\/wordle/i],
  },
];

const URL_SUBSTRING_RE = /\bhttps?:\/\/\S+/gi;

/**
 * True when a shared payload carries no postable result — i.e. after removing
 * URLs and pure-hashtag/blank lines, nothing is left. The canonical case is a
 * game whose iOS share hands our extension only its referral link (e.g.
 * `https://dailytens.com/?ref=944415`) with the 🏆/❌ grid silently dropped at
 * the share-sheet boundary (the extension reads the URL representation of the
 * shared item and never the text). Posting it stores a link with no score and
 * renders as a bare "Played" row, so the share screens block the post and
 * prompt the user to paste their result instead. Mirrors the strip rules in
 * `summarizeScoreBody` so "what we'd refuse to post" matches "what would render
 * as nothing".
 */
export function isResultlessShare(raw: string | null | undefined): boolean {
  const text = raw?.trim() ?? "";
  if (!text) return true;
  const remaining = text
    .split(/\r?\n/)
    .map((line) => line.replace(URL_SUBSTRING_RE, "").trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^#\S+$/.test(line));
  return remaining.length === 0;
}

export function detectSharedScore(raw: string | null | undefined): DetectedSharedScore | null {
  const scoreRaw = raw?.trim() ?? "";
  if (!scoreRaw) return null;
  const pattern = matchTextPattern(scoreRaw);
  if (!pattern) return null;
  return {
    kind: pattern.kind,
    gameLabel: pattern.gameLabel,
    scoreRaw,
    source: "regex",
  };
}

/**
 * Infer which game an item represents from its title / URL / metadata. Used
 * by the clipboard recap to pick a per-game formatter when the saved
 * `scoreRaw` is hand-typed or otherwise doesn't match any text pattern.
 */
export function detectGameKindForItem(item: Item): DetectedSharedScoreKind | null {
  for (const pattern of GAME_PATTERNS) {
    if (itemMatchesPattern(item, pattern)) return pattern.kind;
  }
  return null;
}

function matchTextPattern(text: string): GamePattern | null {
  for (const pattern of GAME_PATTERNS) {
    if (pattern.textPatterns.some((re) => re.test(text))) return pattern;
  }
  return null;
}

export function flattenListItems(data: ListItemsResponse | null | undefined): Item[] {
  if (!data) return [];
  return [...data.ordered, ...data.unordered, ...data.completed];
}

export function pickSuggestedScoreTarget(
  detection: DetectedSharedScore | null,
  lists: readonly ListSummary[],
  itemsByListId: Readonly<Record<string, readonly Item[]>>,
): ShareScoreTarget | null {
  if (!detection) return null;
  const pattern = GAME_PATTERNS.find((p) => p.kind === detection.kind);
  if (!pattern) return null;

  let best: { target: ShareScoreTarget; updatedAtMs: number } | null = null;
  for (const list of lists) {
    if (!list.modules.includes("leaderboard")) continue;
    const items = itemsByListId[list.id] ?? [];
    for (const item of items) {
      if (!itemMatchesPattern(item, pattern)) continue;
      const updatedAtMs = timestamp(item.updatedAt) || timestamp(list.updatedAt);
      if (!best || updatedAtMs > best.updatedAtMs) {
        best = { target: { list, item }, updatedAtMs };
      }
    }
  }

  return best?.target ?? null;
}

function itemMatchesPattern(item: Item, pattern: GamePattern): boolean {
  return searchableItemText(item).some((value) =>
    pattern.itemPatterns.some((re) => re.test(value)),
  );
}

function searchableItemText(item: Item): string[] {
  const content = item.content ?? {};
  return [
    item.title,
    item.url,
    stringField(content.siteName),
    stringField(content.title),
    stringField(content.sourceId),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}
