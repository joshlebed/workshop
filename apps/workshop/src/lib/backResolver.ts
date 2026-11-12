// Pure half of `goBack` (UX pass 3.8): no expo-router import, so it is
// unit-tested directly (backResolver.test.ts).

interface NavRoute {
  name: string;
  params?: object;
  state?: NavState;
}

export interface NavState {
  index?: number;
  routes: NavRoute[];
}

/**
 * URL path for a stack route: `list/[id]/index` + `{ id: "a" }` → `/list/a`.
 * Groups (`(lists)`) and a trailing `index` drop out.
 */
export function routePath(name: string, params: object | undefined): string {
  const values = (params ?? {}) as Record<string, unknown>;
  const segments = name
    .split("/")
    .filter((s) => s.length > 0 && !(s.startsWith("(") && s.endsWith(")")))
    .map((s) => {
      const m = /^\[(?:\.\.\.)?(.+)\]$/.exec(s);
      if (!m) return s;
      const v = values[m[1] ?? ""];
      return Array.isArray(v) ? v.map(String).join("/") : String(v ?? "");
    });
  if (segments[segments.length - 1] === "index") segments.pop();
  return `/${segments.join("/")}`;
}

/** The innermost navigator on the focused path (the stack the screen lives in). */
export function focusedStack(state: NavState | undefined): NavState | null {
  let current = state;
  let stack: NavState | null = null;
  while (current && current.routes.length > 0) {
    stack = current;
    const focused = current.routes[current.index ?? current.routes.length - 1];
    current = focused?.state;
  }
  return stack;
}

function pathOnly(href: string): string {
  const path = href.split(/[?#]/)[0] ?? "/";
  return path.length > 1 ? path.replace(/\/+$/, "") : "/";
}

export type BackAction = "back" | "dismissToParent" | "replaceWithParent";

/**
 * Pure decision behind `goBack`, unit-tested:
 *  - the screen beneath is the parent → pop;
 *  - the screen beneath is the home anchor but the parent is not home → the
 *    screen was opened cold: dismiss to the parent (replace, home stays below);
 *  - anything else beneath (real history) → pop;
 *  - nothing beneath in this stack: pop an outer navigator when one can go
 *    back, else replace with the parent.
 */
export function resolveBack(
  stack: NavState | null,
  parentHref: string,
  canGoBack: boolean,
): BackAction {
  const parent = pathOnly(parentHref);
  const index = stack ? (stack.index ?? stack.routes.length - 1) : 0;
  const beneath = stack && index > 0 ? stack.routes[index - 1] : undefined;
  if (beneath) {
    const beneathPath = routePath(beneath.name, beneath.params);
    if (beneathPath === parent) return "back";
    if (beneathPath === "/" && parent !== "/") return "dismissToParent";
    return "back";
  }
  return canGoBack ? "back" : "replaceWithParent";
}
