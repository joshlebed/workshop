// Share-score detection — thin adapter over the shared game registry
// (@workshop/shared/gameRegistry), which owns the per-game patterns. This
// module keeps the Item-shaped helpers (searchable-text assembly, suggested
// target picking) that only make sense on the client.

import type { Item, ListItemsResponse, ListSummary } from "@workshop/shared";
import {
  type GameDefinition,
  type GameKey,
  gameLabelFor,
  identifyGame,
  isResultlessShare,
  matchShareText,
} from "@workshop/shared/gameRegistry";

export type DetectedSharedScoreKind = GameKey;

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

export { isResultlessShare };

export function detectSharedScore(raw: string | null | undefined): DetectedSharedScore | null {
  const scoreRaw = raw?.trim() ?? "";
  if (!scoreRaw) return null;
  const def = matchShareText(scoreRaw);
  if (!def) return null;
  return {
    kind: def.key,
    gameLabel: gameLabelFor(def),
    scoreRaw,
    source: "regex",
  };
}

/**
 * Infer which game an item represents from its title / URL / metadata. Used
 * by the clipboard recap to pick a per-game formatter when the saved
 * `scoreRaw` is hand-typed or otherwise doesn't match any share pattern.
 */
export function detectGameKindForItem(item: Item): DetectedSharedScoreKind | null {
  return identifyGame(searchableItemText(item))?.key ?? null;
}

/**
 * Same inference as `detectGameKindForItem`, but over a caller-assembled
 * blob of identifying text (title + URL). Used by the Games surface, whose
 * catalog rows aren't `Item`s.
 */
export function detectGameKindForText(text: string): DetectedSharedScoreKind | null {
  return identifyGame([text])?.key ?? null;
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
      if (itemGameKind(item) !== detection.kind) continue;
      const updatedAtMs = timestamp(item.updatedAt) || timestamp(list.updatedAt);
      if (!best || updatedAtMs > best.updatedAtMs) {
        best = { target: { list, item }, updatedAtMs };
      }
    }
  }

  return best?.target ?? null;
}

function itemGameKind(item: Item): GameDefinition["key"] | null {
  return identifyGame(searchableItemText(item))?.key ?? null;
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
