// Clipboard recaps + per-row score distillation. The per-game formatting
// heuristics live on the shared game registry (each entry's
// `formatShareBody`); this module owns the recap composition and the
// Item/Game adapters that pick which registry entry formats a given row.

import type { Item, LeaderboardEntry } from "@workshop/shared";
import { formatShareBodyFallback, gameDefinitionForKey } from "@workshop/shared/gameRegistry";
import type { MyGame } from "@workshop/shared/games";
import {
  type DetectedSharedScoreKind,
  detectGameKindForItem,
  detectGameKindForText,
  detectSharedScore,
} from "./shareScoreDetection";

interface BuildSummaryParams {
  listName: string;
  listUrl: string;
  items: Item[];
  scoresByItem: Record<string, LeaderboardEntry[]>;
  selfId: string | null;
  dateKey: string;
}

interface BuildGameSummaryParams {
  friendUrl: string;
  games: MyGame[];
  selfId: string | null;
  dateKey: string;
}

function detectKind(item: Item, scoreRaw: string): DetectedSharedScoreKind | null {
  return detectSharedScore(scoreRaw)?.kind ?? detectGameKindForItem(item);
}

/**
 * Render `scoreRaw` (and `scoreValue` as a last resort) into the body shown
 * under a `• <title>` bullet in the clipboard recap (and per-row scores on
 * the leaderboard surfaces — byte-identical by construction). Registry
 * formatters handle the games we explicitly support; everything else falls
 * back to a cleaned copy of the raw text, and finally to the numeric
 * scoreValue if even that yields nothing.
 */
export function summarizeScoreBody(
  item: Item,
  entry: { scoreValue: number | null; scoreRaw: string | null },
): string | null {
  return summarizeBody((raw) => detectKind(item, raw), entry);
}

/**
 * Games-surface twin of `summarizeScoreBody`: identical distillation, but the
 * game-kind inference runs over the catalog row's title + URL instead of an
 * `Item`. Keeps a Games card's score block byte-identical to what the same
 * raw result renders as on the Lists surface.
 */
export function summarizeGameScoreBody(
  game: { title: string; url: string | null },
  entry: { scoreValue: number | null; scoreRaw: string | null },
): string | null {
  return summarizeBody(
    (raw) =>
      detectSharedScore(raw)?.kind ?? detectGameKindForText(`${game.title} ${game.url ?? ""}`),
    entry,
  );
}

function summarizeBody(
  detect: (raw: string) => DetectedSharedScoreKind | null,
  entry: { scoreValue: number | null; scoreRaw: string | null },
): string | null {
  const raw = entry.scoreRaw ?? "";
  if (raw.trim()) {
    const kind = detect(raw);
    const formatter = gameDefinitionForKey(kind)?.formatShareBody;
    const formatted = formatter?.(raw);
    if (formatted && formatted.trim().length > 0) return formatted;
    const fallback = formatShareBodyFallback(raw);
    if (fallback && fallback.trim().length > 0) return fallback;
    // Raw was non-empty but stripped to nothing — almost always a URL-only
    // share. `scoreValue` here is whatever number the backend's "first number
    // anywhere" parser pulled from URL query params (e.g. `?ref=944415`), so
    // surface nothing rather than a meaningless digit string.
    return null;
  }
  if (entry.scoreValue !== null && Number.isFinite(entry.scoreValue)) {
    return String(entry.scoreValue);
  }
  return null;
}

/** Locale-aware short date (e.g. "May 27"). No relative labels — the recap
 *  is for a chat conversation where "Today" reads as ambiguous after a few
 *  hours. */
function formatShortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Compose a clipboard-friendly recap of the viewer's own scores on `dateKey`.
 * One bullet per game with a per-game-distilled body underneath; a single
 * trailing link back to the list. Returns `null` when the viewer has
 * nothing to share — caller surfaces a "no scores" toast instead of
 * copying an empty string.
 */
export function buildTodaysScoresSummary({
  listName,
  listUrl,
  items,
  scoresByItem,
  selfId,
  dateKey,
}: BuildSummaryParams): string | null {
  if (!selfId) return null;

  const blocks: string[] = [];
  for (const item of items) {
    const entries = scoresByItem[item.id];
    if (!entries) continue;
    const mine = entries.find((e) => e.userId === selfId);
    if (!mine) continue;
    const body = summarizeScoreBody(item, mine);
    if (!body) continue;
    blocks.push(`• ${item.title}\n${body}`);
  }

  if (blocks.length === 0) return null;

  const header = `My scores in ${listName} — ${formatShortDate(dateKey)}`;
  return `${header}\n${blocks.join("\n")}\n${listUrl}`;
}

/**
 * Games-tab recap: same score distillation as the list copy action, but over
 * My Games and with a personal friend-invite link as the call to action.
 */
export function buildTodaysGameScoresSummary({
  friendUrl,
  games,
  selfId,
  dateKey,
}: BuildGameSummaryParams): string | null {
  if (!selfId) return null;

  const blocks: string[] = [];
  for (const mg of games) {
    const mine = mg.standings.entries.find((e) => e.userId === selfId);
    if (!mine) continue;
    const body = summarizeGameScoreBody(mg.game, mine);
    if (!body) continue;
    blocks.push(`• ${mg.game.title}\n${body}`);
  }

  if (blocks.length === 0) return null;

  const header = `My game scores — ${formatShortDate(dateKey)}`;
  return `${header}\n${blocks.join("\n")}\n${friendUrl}`;
}
