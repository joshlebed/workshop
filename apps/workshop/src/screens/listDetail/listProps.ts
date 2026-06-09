// Shared props between the native (`ItemList.tsx`, react-native-reorderable-list)
// and web (`ItemList.web.tsx`, @dnd-kit/sortable) implementations of the
// list-detail row container.

import type {
  Item,
  ItemKind,
  LeaderboardEntry,
  ListMemberSummary,
  ModuleName,
} from "@workshop/shared";
import type { Section } from "./types";

export interface ReorderEvent {
  fromIndex: number;
  toIndex: number;
}

export interface ItemListProps {
  ordered: Item[];
  unordered: Item[];
  completed: Item[];
  /** The parent list's `itemKind` — drives kind-aware row rendering. */
  listItemKind: ItemKind | null;
  /** Modules enabled on the list — drives section visibility + affordances. */
  modules: ModuleName[];
  /** True iff `listItemKind === "spotify_album"`. */
  isAlbumShelf: boolean;
  showOrderedHint: boolean;
  newItemIds: Set<string>;
  memberNameById: Map<string, string>;
  showProvenance: boolean;
  selfId: string | null;
  /**
   * Leaderboard lists: today's player count keyed by itemId. Presence (along
   * with `totalPlayers`) swaps the per-row "Added by …" provenance line for
   * "X of Y played" so the social signal lives on the item, not who first
   * pasted the URL.
   */
  playedByItem?: Map<string, number>;
  /** Group size for the "X of Y played" label. Pair with `playedByItem`. */
  totalPlayers?: number;
  /**
   * Leaderboard lists render each game as a rich `GameLeaderboardCard` (full
   * standings + Play CTA) instead of an `ItemRow`. The next five props feed
   * those cards; they're ignored on every other list type.
   */
  isGameKind?: boolean;
  /**
   * Whether `scoresByItem` is today's standings (vs a past day picked from the
   * day rail). Forwarded to each card so past days drop the "…today" wording
   * and hide the Play CTA. Defaults to today when omitted.
   */
  viewingToday?: boolean;
  /** Scored players per game for the viewed day, server-ranked. Keyed by itemId. */
  scoresByItem?: Record<string, LeaderboardEntry[]>;
  /** Full member roster — the "of N" denominator + the empty-state facepile. */
  members?: ListMemberSummary[];
  /** Scores query still in flight — cards show skeleton standings. */
  scoresLoading?: boolean;
  /** Open the game externally + arm the paste-on-return prompt. */
  onPlayGame?: (item: Item) => void;
  /** Manual paste fallback from a card — opens the paste sheet. */
  onPasteScore?: (item: Item) => void;
  accent: string;
  onReorderOrdered: (event: ReorderEvent) => void;
  onPromoteToOrdered: (event: { item: Item; toIndex: number }) => void;
  onRowMenu: (item: Item, section: Section) => void;
  onRowPressBody: (item: Item, section: Section) => void;
  onUncompleteItem: (item: Item) => void;
  resolveRowPressCover?: (item: Item, section: Section) => (() => void) | null;
  refreshing: boolean;
  onRefresh: () => void;
}
