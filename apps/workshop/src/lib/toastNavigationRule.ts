// Pure half of the toast navigation rule (UX pass 5, review carry-over 3):
// a toast belongs to the screen that raised it. Opening a screen that was not
// already in the navigation state (a push, a modal, a replace) dismisses the
// toasts raised before it; going back to a screen that was there keeps them.
// Unit-tested in toastNavigationRule.test.ts; wired in `ToastNavigationRule`.

export interface KeyedNavState {
  index?: number;
  routes: { key: string; state?: KeyedNavState | object }[];
}

function isNavState(value: unknown): value is KeyedNavState {
  return (
    !!value && typeof value === "object" && Array.isArray((value as { routes?: unknown }).routes)
  );
}

/** Every route key in the tree, and the key of the focused leaf screen. */
export function collectRouteKeys(state: unknown): { focused: string | null; all: Set<string> } {
  const all = new Set<string>();
  const walk = (s: KeyedNavState) => {
    for (const r of s.routes) {
      all.add(r.key);
      if (isNavState(r.state)) walk(r.state);
    }
  };
  if (!isNavState(state)) return { focused: null, all };
  walk(state);
  let focused: string | null = null;
  let current: KeyedNavState | undefined = state;
  while (current && current.routes.length > 0) {
    const route: KeyedNavState["routes"][number] | undefined =
      current.routes[current.index ?? current.routes.length - 1];
    if (!route) break;
    focused = route.key;
    current = isNavState(route.state) ? route.state : undefined;
  }
  return { focused, all };
}

/** True when the focused screen of `next` was not anywhere in `previous`. */
export function openedNewScreen(previous: Set<string> | null, next: unknown): boolean {
  if (!previous) return false;
  const { focused } = collectRouteKeys(next);
  return focused !== null && !previous.has(focused);
}
