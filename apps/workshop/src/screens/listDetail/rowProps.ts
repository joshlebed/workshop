import type { Item } from "@workshop/shared";
import type { ComponentProps } from "react";
import type { ItemRow } from "./ItemRow";
import type { ItemListProps } from "./listProps";
import type { Section } from "./types";

type RowProps = ComponentProps<typeof ItemRow>;

/**
 * The per-row props both list implementations build the same way; each
 * platform adds its own drag plumbing (`isDragging`, `dragHandle`,
 * `onLongPressBody`) on top.
 */
export function baseRowProps(
  p: ItemListProps,
  item: Item,
  section: Section,
): Omit<RowProps, "isDragging"> {
  const addedByName =
    !p.showProvenance || (p.selfId && item.addedBy === p.selfId)
      ? null
      : (p.memberNameById.get(item.addedBy) ?? null);
  const done = section === "completed";
  const checked = done || (p.heldDoneIds?.has(item.id) ?? false);
  const override = p.letterboxdBadgeByItem?.get(item.id);
  return {
    item,
    section,
    ...(section === "ordered" ? { rank: p.rankById.get(item.id) } : {}),
    isNew: p.newItemIds.has(item.id),
    addedByName,
    ...(override ? { provenanceOverride: override } : {}),
    accent: p.accent,
    showCover: p.showCover,
    doneWord: p.copy.done,
    ...(p.todoOn && item.kind !== "spotify_album"
      ? {
          checkbox: {
            checked,
            onToggle: () => p.onToggleComplete(item, !checked),
            hint: checked ? p.copy.unmark : p.copy.mark,
          },
        }
      : {}),
    onMenu: () => p.onRowMenu(item, section),
    onPressBody: () => p.onRowPressBody(item, section),
  };
}
