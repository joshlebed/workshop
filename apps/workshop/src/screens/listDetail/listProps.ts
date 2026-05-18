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
  accent: string;
  onReorderOrdered: (event: ReorderEvent) => void;
  onPromoteToOrdered: (event: { item: Item; toIndex: number }) => void;
  onRowMenu: (item: Item, section: Section) => void;
  onRowPressBody: (item: Item, section: Section) => void;
  onUncompleteItem: (item: Item) => void;
  onUpvote?: (item: Item) => void;
  resolveRowPressCover?: (item: Item, section: Section) => (() => void) | null;
  refreshing: boolean;
  onRefresh: () => void;
}
