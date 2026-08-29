// Clipboard recaps + per-row score distillation. The per-game formatting
// heuristics live on the shared game registry (each entry's
// `formatShareBody`); this module owns the recap composition and the
// Item/Game adapters that pick which registry entry formats a given row.

import { formatShareBodyFallback, gameDefinitionForKey } from "@workshop/shared/gameRegistry";
import type { MyGame } from "@workshop/shared/games";
import { evaluateSummarySpec, type SummarySpec } from "@workshop/shared/summarySpec";
import {
  type DetectedSharedScoreKind,
  detectGameKindForText,
  detectSharedScore,
} from "./shareScoreDetection";

interface BuildGameSummaryParams {
  shareUrl: string;
  games: MyGame[];
  selfId: string | null;
  dateKey: string;
}

/**
 * Render `scoreRaw` (and `scoreValue` as a last resort) into the body shown
 * under a `• <title>` bullet in the Games clipboard recap and the per-row
 * score on a Games standings card. The game-kind inference runs over the
 * catalog row's title + URL. Registry formatters handle the games we
 * explicitly support; a user-taught `summarySpec` (built in the teach flow's
 * recap preview) stands in for a hand-written `formatShareBody`; everything
 * else falls back to a cleaned copy of the raw text, and finally to the
 * numeric scoreValue if even that yields nothing.
 */
export function summarizeGameScoreBody(
  game: { title: string; url: string | null; summarySpec?: SummarySpec | null },
  entry: { scoreValue: number | null; scoreRaw: string | null },
): string | null {
  return summarizeBody(
    (raw) =>
      detectSharedScore(raw)?.kind ?? detectGameKindForText(`${game.title} ${game.url ?? ""}`),
    entry,
    game.summarySpec ?? null,
  );
}

function summarizeBody(
  detect: (raw: string) => DetectedSharedScoreKind | null,
  entry: { scoreValue: number | null; scoreRaw: string | null },
  summarySpec: SummarySpec | null = null,
): string | null {
  const raw = entry.scoreRaw ?? "";
  if (raw.trim()) {
    const kind = detect(raw);
    const formatter = gameDefinitionForKey(kind)?.formatShareBody;
    const formatted = formatter?.(raw);
    if (formatted && formatted.trim().length > 0) return formatted;
    // Taught recap formatter — the user-built equivalent of a registry
    // formatter. A spec that matches nothing on this share (changed format,
    // URL-only payload) yields null and defers to the fallback below.
    const taught = summarySpec ? evaluateSummarySpec(summarySpec, raw) : null;
    if (taught && taught.trim().length > 0) return taught;
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
 * Games-tab recap: one bullet per game with a per-game-distilled body
 * underneath, and a personal play link (`/g/:token`) as the call to action —
 * opening it routes an existing friend to the Games home and everyone else to
 * the sharer's profile (NOT a friend-accept flow, even between existing friends).
 * Returns `null` when the viewer has nothing to share — the caller surfaces a
 * "no scores" toast instead of copying an empty string.
 */
export function buildTodaysGameScoresSummary({
  shareUrl,
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
  return `${header}\n${blocks.join("\n")}\n${shareUrl}`;
}
