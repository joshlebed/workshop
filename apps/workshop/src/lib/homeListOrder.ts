/**
 * The order lists appear in on home, shared with the share-sheet list picker
 * so both read the same (UX pass 0.17): hidden ("archived" per viewer) lists
 * are left out; pinned lists come first, most recently pinned on top; the
 * rest follow by their latest activity, falling back to `updatedAt`.
 */
export interface OrderableList {
  id: string;
  archivedAt: string | null;
  pinnedAt: string | null;
  updatedAt: string;
}

export function homeListOrder<T extends OrderableList>(
  lists: readonly T[],
  latestActivityAt: (listId: string) => string | undefined = () => undefined,
): T[] {
  return lists
    .filter((l) => !l.archivedAt)
    .sort((a, b) => {
      const ap = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
      const bp = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
      if (ap !== bp) return bp - ap;
      const ta = latestActivityAt(a.id) ?? a.updatedAt;
      const tb = latestActivityAt(b.id) ?? b.updatedAt;
      return new Date(tb).getTime() - new Date(ta).getTime();
    });
}
