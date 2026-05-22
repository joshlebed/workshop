import type { Item, LeaderboardEntry } from "@workshop/shared";
import { formatGameDateLabel } from "./gameDate";

interface BuildSummaryParams {
  listName: string;
  items: Item[];
  scoresByItem: Record<string, LeaderboardEntry[]>;
  selfId: string | null;
  dateKey: string;
}

/**
 * Compose a clipboard-friendly recap of the viewer's own scores on `dateKey`.
 * Items appear in the order they're passed in (i.e. the order the user sees
 * them on the list screen), and each game's `scoreRaw` is preserved verbatim
 * so emoji grids land intact in iMessage / Discord / etc. Returns `null` when
 * the viewer has nothing to brag about yet — caller shows a "no scores"
 * toast in that case.
 */
export function buildTodaysScoresSummary({
  listName,
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
    const raw = mine?.scoreRaw?.trim();
    if (!raw) continue;
    blocks.push(`${item.title}\n${raw}`);
  }

  if (blocks.length === 0) return null;

  const dateLabel = formatGameDateLabel(dateKey);
  const header = `${listName} — ${dateLabel}`;
  return `${header}\n\n${blocks.join("\n\n")}`;
}
