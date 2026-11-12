/**
 * Items added from the quick-add screen, waiting for the list to show them
 * (2.6). The add surface stays open across several adds, so it records ids
 * here and the list picks them up when it regains focus: it highlights the
 * rows (`newItemIds`) and scrolls to the newest. Session memory only.
 */
const pending = new Map<string, string[]>();

export function noteItemAdded(listId: string, itemId: string): void {
  pending.set(listId, [itemId, ...(pending.get(listId) ?? []).filter((id) => id !== itemId)]);
}

export function forgetItemAdded(listId: string, itemId: string): void {
  const next = (pending.get(listId) ?? []).filter((id) => id !== itemId);
  if (next.length > 0) pending.set(listId, next);
  else pending.delete(listId);
}

/** Newest first; clears the list's queue. */
export function takeItemsAdded(listId: string): string[] {
  const ids = pending.get(listId) ?? [];
  pending.delete(listId);
  return ids;
}
