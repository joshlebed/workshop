import type { Item, LeaderboardEntry } from "@workshop/shared";
import { formatGameDateLabel } from "./gameDate";

interface BuildSummaryParams {
  listName: string;
  listUrl: string;
  items: Item[];
  scoresByItem: Record<string, LeaderboardEntry[]>;
  selfId: string | null;
  dateKey: string;
}

const URL_RE = /\bhttps?:\/\/\S+/gi;

function stripUrls(text: string): string {
  return text.replace(URL_RE, "").replace(/[ \t]+/g, " ");
}

/**
 * Distill an entry into one tight line for the clipboard recap. Prefers the
 * server-parsed `scoreValue` when present (it's already canonical — the
 * per-item `score_regex` extracted it); falls back to the first meaningful
 * line of `scoreRaw` with URLs and surrounding whitespace stripped. Returns
 * `null` when there's no usable signal so the caller can drop the row.
 */
export function summarizeScoreLine(entry: {
  scoreValue: number | null;
  scoreRaw: string | null;
}): string | null {
  if (entry.scoreValue !== null && Number.isFinite(entry.scoreValue)) {
    return String(entry.scoreValue);
  }
  const raw = entry.scoreRaw;
  if (!raw) return null;
  const cleaned = stripUrls(raw);
  for (const line of cleaned.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    // Pure emoji/symbol lines (grids, decorative borders) carry no
    // text the recipient can read out — skip.
    if (!/[A-Za-z0-9]/.test(trimmed)) continue;
    // Promotional hashtag trailers (`#globle`, `#dailygame`) sit on
    // their own line and aren't the score — skip if the whole line is
    // a single hashtag.
    if (/^#\S+$/.test(trimmed)) continue;
    return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
  }
  return null;
}

/**
 * Compose a clipboard-friendly recap of the viewer's own scores on `dateKey`.
 * Tight by design: one bullet per game (title + short score), a date-aware
 * header, and a single trailing link back to the list. Returns `null` when
 * the viewer has nothing to share — caller surfaces a "no scores" toast
 * instead of copying an empty string.
 *
 * Emoji grids and the `https://wordle-game.com` link that most games append
 * are intentionally dropped here; the recap is for the conversation, the
 * link is for the recipient to come join.
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

  const lines: string[] = [];
  for (const item of items) {
    const entries = scoresByItem[item.id];
    if (!entries) continue;
    const mine = entries.find((e) => e.userId === selfId);
    if (!mine) continue;
    const score = summarizeScoreLine(mine);
    if (!score) continue;
    lines.push(`• ${item.title}: ${score}`);
  }

  if (lines.length === 0) return null;

  const header = `${listName} — ${formatGameDateLabel(dateKey)}`;
  return `${header}\n\n${lines.join("\n")}\n\n${listUrl}`;
}
