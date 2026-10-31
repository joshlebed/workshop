// Layout engines shared by the web canvases and the native renderer. All pure
// JS, no DOM: d3-force, graphology + ForceAtlas2 + Louvain, and a radial tree
// for the inferred invite forest. Each returns plain `{ x, y }` per user so the
// native canvas can draw the result with ordinary views.

import type { AdminGraphNode, AdminGraphResponse } from "@workshop/shared";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import random from "graphology-layout/random";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { type InviteTree, radiusFor, subtreeSize } from "./model";

export interface Point {
  x: number;
  y: number;
}
export type Positions = Map<string, Point>;

/** Deterministic PRNG so layouts and community colours are stable across renders. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type SimNode = SimulationNodeDatum & { id: string; r: number };

/**
 * A settled d3-force layout of the whole graph (synchronous ticks — the
 * native canvas draws static positions and animates the camera instead).
 */
export function runForceLayout(data: AdminGraphResponse, ticks = 300): Positions {
  const rng = mulberry32(3);
  const nodes: SimNode[] = data.nodes.map((n, i) => ({
    id: n.id,
    r: radiusFor(n),
    x: Math.cos(i) * 120 + (rng() - 0.5) * 40,
    y: Math.sin(i) * 120 + (rng() - 0.5) * 40,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links: SimulationLinkDatum<SimNode>[] = data.edges
    .filter((e) => byId.has(e.source) && byId.has(e.target))
    .map((e) => ({ source: byId.get(e.source) as SimNode, target: byId.get(e.target) as SimNode }));
  const sim = forceSimulation<SimNode>(nodes)
    .force(
      "link",
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
        .distance((l) => 36 + (l.source as SimNode).r + (l.target as SimNode).r)
        .strength(0.6),
    )
    .force("charge", forceManyBody<SimNode>().strength(-180).distanceMax(420))
    .force("collide", forceCollide<SimNode>((d) => d.r + 10).iterations(2))
    .force("center", forceCenter(0, 0).strength(0.05))
    // A gentle pull to the middle so users with no friends don't fly off and
    // force the fit-to-screen to zoom out around them.
    .force("x", forceX<SimNode>(0).strength(0.05))
    .force("y", forceY<SimNode>(0).strength(0.05))
    .velocityDecay(0.35)
    .stop();
  sim.tick(ticks);
  return new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
}

export interface Community {
  id: number;
  members: AdminGraphNode[];
  /** Highest-degree member, the cluster's "anchor". */
  anchor: AdminGraphNode;
}

export interface CommunityLayout {
  /** The graphology graph (positions + attributes), for sigma on web. */
  graph: Graph;
  positions: Positions;
  /** Biggest first; index = colour slot. */
  communities: Community[];
  communityOf: Map<string, number>;
}

/** ForceAtlas2 positions + Louvain communities, renumbered biggest-first. */
export function runCommunityLayout(data: AdminGraphResponse): CommunityLayout {
  const g = new Graph({ type: "undirected" });
  const nodesById = new Map(data.nodes.map((n) => [n.id, n]));
  for (const n of data.nodes) {
    g.addNode(n.id, {
      size: 4 + Math.min(16, n.friendCount * 1.1),
      isolated: n.friendCount === 0 ? 1 : 0,
    });
  }
  for (const e of data.edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target) && !g.hasEdge(e.source, e.target)) {
      g.addEdge(e.source, e.target, {});
    }
  }
  random.assign(g, { scale: 100, rng: mulberry32(42) });
  if (g.order > 0) {
    const settings = forceAtlas2.inferSettings(g);
    forceAtlas2.assign(g, {
      iterations: 600,
      settings: { ...settings, gravity: 1.2, scalingRatio: 8 },
    });
  }
  const mapping: Record<string, number> =
    g.order > 0 ? louvain(g, { rng: mulberry32(7), resolution: 1 }) : {};
  const groups = new Map<number, AdminGraphNode[]>();
  for (const [id, c] of Object.entries(mapping)) {
    const n = nodesById.get(id);
    if (!n) continue;
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)?.push(n);
  }
  const ordered = [...groups.values()].sort(
    (a, b) => b.length - a.length || (a[0]?.createdAt ?? "").localeCompare(b[0]?.createdAt ?? ""),
  );
  const communityOf = new Map<string, number>();
  const communities: Community[] = ordered.map((members, i) => {
    const anchor = [...members].sort((a, b) => b.friendCount - a.friendCount)[0] as AdminGraphNode;
    for (const m of members) {
      communityOf.set(m.id, i);
      g.setNodeAttribute(m.id, "community", i);
    }
    return { id: i, members, anchor };
  });
  // ForceAtlas2's coordinates are tiny relative to node radii; sigma
  // auto-rescales to its viewport but the native canvas draws in layout
  // units, so normalise the spread to ~900 units across the longer side.
  const raw: Positions = new Map();
  g.forEachNode((id, attrs) => raw.set(id, { x: Number(attrs.x), y: Number(attrs.y) }));
  const b = boundsOf(raw);
  const span = Math.max(1, b.maxX - b.minX, b.maxY - b.minY);
  const k = 900 / span;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const positions: Positions = new Map();
  for (const [id, p] of raw) positions.set(id, { x: (p.x - cx) * k, y: (p.y - cy) * k });
  return { graph: g, positions, communities, communityOf };
}

/**
 * Radial invite tree: seeds with descendants share the centre, each
 * generation is one ring further out, and every subtree gets an angular
 * sector proportional to its size so branches don't cross. Childless seeds
 * (users with no older friend and nobody downstream) sit on the outermost
 * ring so they don't crowd the middle.
 */
export function runRadialTreeLayout(
  data: AdminGraphResponse,
  tree: InviteTree,
  ringGap = 110,
): Positions {
  const positions: Positions = new Map();
  const weight = (id: string) => 1 + subtreeSize(tree, id);
  const seeds = tree.roots.filter((id) => (tree.children.get(id)?.length ?? 0) > 0);
  const loners = tree.roots.filter((id) => (tree.children.get(id)?.length ?? 0) === 0);
  const maxDepth = Math.max(0, ...tree.depth.values());

  const place = (id: string, depth: number, from: number, to: number) => {
    const angle = (from + to) / 2;
    const r = depth === 0 && seeds.length === 1 ? 0 : depth * ringGap + (depth === 0 ? 40 : 0);
    positions.set(id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    const kids = tree.children.get(id) ?? [];
    const total = kids.reduce((s, k) => s + weight(k), 0);
    let cursor = from;
    for (const kid of kids) {
      const span = ((to - from) * weight(kid)) / total;
      place(kid, depth + 1, cursor, cursor + span);
      cursor += span;
    }
  };

  const seedTotal = seeds.reduce((s, id) => s + weight(id), 0);
  let cursor = -Math.PI / 2;
  for (const seed of seeds) {
    const span = (2 * Math.PI * weight(seed)) / seedTotal;
    place(seed, 0, cursor, cursor + span);
    cursor += span;
  }
  const outer = (maxDepth + 1) * ringGap + 40;
  loners.forEach((id, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, loners.length);
    positions.set(id, { x: Math.cos(angle) * outer, y: Math.sin(angle) * outer });
  });
  for (const n of data.nodes) if (!positions.has(n.id)) positions.set(n.id, { x: 0, y: 0 });
  return positions;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(positions: Positions, pad = 0): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x - pad);
    minY = Math.min(minY, p.y - pad);
    maxX = Math.max(maxX, p.x + pad);
    maxY = Math.max(maxY, p.y + pad);
  }
  if (!Number.isFinite(minX)) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

/** Translate + scale that fits `bounds` inside a `width`×`height` viewport. */
export function fitTransform(
  bounds: Bounds,
  width: number,
  height: number,
  padding = 24,
): { x: number; y: number; k: number } {
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const k = Math.max(0.1, Math.min(2, (width - padding * 2) / w, (height - padding * 2) / h));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { x: width / 2 - cx * k, y: height / 2 - cy * k, k };
}
