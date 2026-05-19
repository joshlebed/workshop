import type { Item, ListItemsResponse, ListSummary } from "@workshop/shared";

export type DetectedSharedScoreKind = "maptap";

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

const MAPTAP_RE = /\bmap\s*tap\b|\bmaptap\b/i;

export function detectSharedScore(raw: string | null | undefined): DetectedSharedScore | null {
  const scoreRaw = raw?.trim() ?? "";
  if (!scoreRaw || !MAPTAP_RE.test(scoreRaw)) return null;
  return {
    kind: "maptap",
    gameLabel: "MapTap",
    scoreRaw,
    source: "regex",
  };
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

  let best: { target: ShareScoreTarget; updatedAtMs: number } | null = null;
  for (const list of lists) {
    if (!list.modules.includes("leaderboard")) continue;
    const items = itemsByListId[list.id] ?? [];
    for (const item of items) {
      if (!itemMatchesDetection(item, detection)) continue;
      const updatedAtMs = timestamp(item.updatedAt) || timestamp(list.updatedAt);
      if (!best || updatedAtMs > best.updatedAtMs) {
        best = { target: { list, item }, updatedAtMs };
      }
    }
  }

  return best?.target ?? null;
}

function itemMatchesDetection(item: Item, detection: DetectedSharedScore): boolean {
  switch (detection.kind) {
    case "maptap":
      return searchableItemText(item).some((value) => MAPTAP_RE.test(value));
  }
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
