/**
 * Web: call just before a row is removed (delete from its menu). When its
 * removal drops focus to `<body>`, focus moves to the row that took its place
 * (or the one above it at the end of the list), so a keyboard user keeps
 * their position instead of starting again from the top of the page.
 *
 * Rows are found by `testID` (`data-testid`): `${prefix}${id}`.
 */
export function keepFocusNearRow(rowTestIdPrefix: string, id: string): void {
  if (typeof document === "undefined") return;
  // Only the rows themselves: `list-card-<id>`, not the row's own
  // `list-card-subtitle-<id>` / `list-card-more-<id>` parts.
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-testid^="${rowTestIdPrefix}"]`),
  ).filter(
    (el) =>
      el.getClientRects().length > 0 &&
      /^[0-9a-f-]{8,}$/i.test((el.dataset.testid ?? "").slice(rowTestIdPrefix.length)),
  );
  const at = rows.findIndex((el) => el.dataset.testid === `${rowTestIdPrefix}${id}`);
  if (at === -1) return;
  const neighbour = rows[at + 1] ?? rows[at - 1];
  const targetId = neighbour?.dataset.testid;
  if (!targetId) return;
  // Watch for a moment: the menu sheet closes first (handing focus back to
  // its opener, the doomed row's own button), then the row leaves after its
  // exit motion. Whenever focus has fallen to <body> in that window, catch it.
  let ticks = 0;
  const settle = () => {
    const active = document.activeElement;
    const lost = !active || active === document.body || !document.contains(active);
    if (lost) document.querySelector<HTMLElement>(`[data-testid="${targetId}"]`)?.focus();
    ticks += 1;
    if (ticks < 30) setTimeout(settle, 50);
  };
  setTimeout(settle, 50);
}

/**
 * Web: call just before an action that re-renders the focused control as a
 * new node (ticking a row moves it into Done and back). For a moment after,
 * whenever focus has fallen to <body>, put it back on the control with the
 * same `testID`, wherever it now is. A control that is gone (a collapsed
 * Done section) is left alone.
 */
export function keepFocusOn(
  testId: string,
  { force = false, windowMs = 1000 }: { force?: boolean; windowMs?: number } = {},
): void {
  if (typeof document === "undefined") return;
  let ticks = 0;
  let forced = false;
  const settle = () => {
    const active = document.activeElement;
    const lost = !active || active === document.body || !document.contains(active);
    const target = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    // `force`: move there once it exists (an Undo brings the row back, and
    // focus belongs on it even though it never fell to <body>).
    if (target && (lost || (force && !forced))) {
      target.focus();
      forced = true;
    }
    ticks += 1;
    if (ticks < windowMs / 50) setTimeout(settle, 50);
  };
  setTimeout(settle, 50);
}

/**
 * Web: `keepFocusOn` only when the control has focus right now (a row about
 * to move after the tick hold: keep focus with it only if it was there).
 */
export function keepFocusIfOn(testId: string): void {
  if (typeof document === "undefined") return;
  if ((document.activeElement as HTMLElement | null)?.dataset?.testid !== testId) return;
  keepFocusOn(testId, { windowMs: 1500 });
}
