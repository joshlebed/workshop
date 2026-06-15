// Shared props between the native (`ItemList.tsx`, react-native-reorderable-list)
// and web (`ItemList.web.tsx`, @dnd-kit/sortable) implementations of the
// list-detail row container.

import type { Item, ItemKind, ModuleName } from "@workshop/shared";
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
   * Letterboxd-match lists: per-item overlap badge ("On 3 watchlists · …")
   * that replaces the "Added by …" provenance line. Keyed by itemId; rows
   * absent from the map keep the default provenance.
   */
  letterboxdBadgeByItem?: Map<string, string>;
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
