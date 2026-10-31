// Pure helpers shared by the three admin "users web" designs: adjacency,
// join cohorts, the inferred invite tree, and the display scales. No DOM, no
// React — unit-tested in model.test.ts and imported by every view variant.

import type { AdminGraphEdge, AdminGraphNode, AdminGraphResponse } from "@workshop/shared";

export interface GraphViewProps {
  data: AdminGraphResponse;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /**
   * Ask the canvas to pan/zoom to a user. `nonce` changes on every request so
   * locating the already-selected user again still animates.
   */
  focus?: { id: string; nonce: number } | null;
  /** Pixel height the view should fill. */
  height: number;
  /** Dark or light palette; the canvases can't read React Native styles. */
  palette: GraphPalette;
}

export interface GraphPalette {
  canvas: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  /** Ordinal hues for cohorts / communities / generations (CVD-friendly order). */
  series: string[];
}

export const DAY_MS = 86_400_000;

export function displayName(node: Pick<AdminGraphNode, "displayName" | "email">): string {
  const name = node.displayName?.trim();
  if (name) return name;
  const email = node.email?.trim();
  if (email) return email.split("@")[0] ?? email;
  return "Unnamed";
}

/** Friend ids per user, from the undirected edge list. */
export function adjacency(edges: AdminGraphEdge[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!out.has(e.source)) out.set(e.source, new Set());
    if (!out.has(e.target)) out.set(e.target, new Set());
    out.get(e.source)?.add(e.target);
    out.get(e.target)?.add(e.source);
  }
  return out;
}

/** Friends of `id`, each with when the friendship formed, oldest first. */
export function friendsOf(
  id: string,
  edges: AdminGraphEdge[],
  nodesById: Map<string, AdminGraphNode>,
): { node: AdminGraphNode; since: string }[] {
  const out: { node: AdminGraphNode; since: string }[] = [];
  for (const e of edges) {
    const other = e.source === id ? e.target : e.target === id ? e.source : null;
    if (!other) continue;
    const node = nodesById.get(other);
    if (node) out.push({ node, since: e.createdAt });
  }
  return out.sort((a, b) => a.since.localeCompare(b.since));
}

/** `YYYY-MM` the account was created, the unit of a join cohort. */
export function cohortOf(node: Pick<AdminGraphNode, "createdAt">): string {
  return node.createdAt.slice(0, 7);
}

/** Distinct cohorts in chronological order. */
export function cohorts(nodes: Pick<AdminGraphNode, "createdAt">[]): string[] {
  return [...new Set(nodes.map(cohortOf))].sort();
}

export function cohortLabel(cohort: string): string {
  const [y, m] = cohort.split("-");
  const month = Number(m);
  const names = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${names[month - 1] ?? m} ${y}`;
}

/** Node radius in px: sqrt-scaled on scores so a 500-score user isn't 100× a 5-score one. */
export function radiusFor(node: Pick<AdminGraphNode, "scoreCount">, min = 6, max = 22): number {
  const r = min + Math.sqrt(node.scoreCount) * 0.7;
  return Math.min(max, Math.max(min, r));
}

export type ActivityBand = "week" | "month" | "dormant" | "never";

/** How recently the user was active in HighScore, relative to `now`. */
export function activityBand(node: Pick<AdminGraphNode, "lastActiveDay">, now: Date): ActivityBand {
  if (!node.lastActiveDay) return "never";
  const age = (now.getTime() - Date.parse(`${node.lastActiveDay}T00:00:00Z`)) / DAY_MS;
  if (age <= 7) return "week";
  if (age <= 30) return "month";
  return "dormant";
}

export const ACTIVITY_BAND_LABEL: Record<ActivityBand, string> = {
  week: "Active this week",
  month: "Active this month",
  dormant: "Dormant (30d+)",
  never: "Never active",
};

/**
 * The inferred invite tree. HighScore has no "invited by" column, so the
 * parent of a user is the counterpart in their *earliest* friendship whose
 * account is older than theirs — the person most likely to have brought them
 * in. Users with no such friend are roots (seeds / organic sign-ups). Depth is
 * the generation: 0 = seed, 1 = brought in by a seed, …
 */
export interface InviteTree {
  parent: Map<string, string | null>;
  children: Map<string, string[]>;
  depth: Map<string, number>;
  roots: string[];
  /** Edge keys (`source|target`) that are part of the tree. */
  treeEdgeKeys: Set<string>;
}

export function edgeKey(e: Pick<AdminGraphEdge, "source" | "target">): string {
  return `${e.source}|${e.target}`;
}

export function inferInviteTree(data: AdminGraphResponse): InviteTree {
  const nodesById = new Map(data.nodes.map((n) => [n.id, n]));
  const parent = new Map<string, string | null>();
  const treeEdgeKeys = new Set<string>();
  const sortedEdges = [...data.edges].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const node of data.nodes) {
    let chosen: AdminGraphEdge | null = null;
    for (const e of sortedEdges) {
      const other = e.source === node.id ? e.target : e.target === node.id ? e.source : null;
      if (!other) continue;
      const otherNode = nodesById.get(other);
      if (!otherNode) continue;
      if (otherNode.createdAt < node.createdAt) {
        chosen = e;
        break;
      }
    }
    if (chosen) {
      parent.set(node.id, chosen.source === node.id ? chosen.target : chosen.source);
      treeEdgeKeys.add(edgeKey(chosen));
    } else {
      parent.set(node.id, null);
    }
  }

  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const node of data.nodes) {
    const p = parent.get(node.id) ?? null;
    if (p === null) roots.push(node.id);
    else {
      if (!children.has(p)) children.set(p, []);
      children.get(p)?.push(node.id);
    }
  }
  for (const list of children.values()) {
    list.sort((a, b) =>
      (nodesById.get(a)?.createdAt ?? "").localeCompare(nodesById.get(b)?.createdAt ?? ""),
    );
  }

  const depth = new Map<string, number>();
  const queue: [string, number][] = roots.map((id) => [id, 0]);
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    const [id, d] = next;
    if (depth.has(id)) continue;
    depth.set(id, d);
    for (const child of children.get(id) ?? []) queue.push([child, d + 1]);
  }
  return { parent, children, depth, roots, treeEdgeKeys };
}

/** Number of users in the subtree under `id` (excluding `id`). */
export function subtreeSize(tree: InviteTree, id: string): number {
  let n = 0;
  const stack = [...(tree.children.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) break;
    n += 1;
    stack.push(...(tree.children.get(next) ?? []));
  }
  return n;
}

/** Earliest and latest timestamps across accounts and friendships, for the time scrubber. */
export function timeDomain(data: AdminGraphResponse): { start: number; end: number } {
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  for (const n of data.nodes) {
    const t = Date.parse(n.createdAt);
    if (!Number.isNaN(t)) {
      start = Math.min(start, t);
      end = Math.max(end, t);
    }
  }
  for (const e of data.edges) {
    const t = Date.parse(e.createdAt);
    if (!Number.isNaN(t)) {
      start = Math.min(start, t);
      end = Math.max(end, t);
    }
  }
  if (!Number.isFinite(start)) start = Date.now();
  return { start, end: Math.max(end, start) };
}

export function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export type UserSortKey =
  | "name"
  | "friendCount"
  | "scoreCount"
  | "gamesScored"
  | "activeDays30"
  | "lastActiveDay"
  | "createdAt";

/** Stable sort for the users table; nulls (never active) always sort last. */
export function sortUsers(
  nodes: AdminGraphNode[],
  key: UserSortKey,
  desc: boolean,
): AdminGraphNode[] {
  const dir = desc ? -1 : 1;
  const cmp = (a: AdminGraphNode, b: AdminGraphNode): number => {
    switch (key) {
      case "name":
        return displayName(a).localeCompare(displayName(b)) * dir;
      case "lastActiveDay":
        if (a.lastActiveDay === b.lastActiveDay) return 0;
        if (a.lastActiveDay === null) return 1;
        if (b.lastActiveDay === null) return -1;
        return a.lastActiveDay.localeCompare(b.lastActiveDay) * dir;
      case "createdAt":
        return a.createdAt.localeCompare(b.createdAt) * dir;
      default:
        return (a[key] - b[key]) * dir;
    }
  };
  return [...nodes].sort((a, b) => cmp(a, b) || a.id.localeCompare(b.id));
}
