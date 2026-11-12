// When the Done section grows past this many rows it starts collapsed, so the
// open part of the list stays in view. Tapping the header toggles it; the
// choice is remembered per list for the session (2.10).
export const COMPLETED_COLLAPSE_THRESHOLD = 5;

const collapsedByList = new Map<string, boolean>();

export function rememberedDoneCollapsed(listId: string): boolean | undefined {
  return collapsedByList.get(listId);
}

export function rememberDoneCollapsed(listId: string, collapsed: boolean): void {
  collapsedByList.set(listId, collapsed);
}
