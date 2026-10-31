// Design B — "Communities": a sigma.js WebGL canvas over a graphology graph.
// ForceAtlas2 settles the layout, Louvain community detection colours each
// friend group, node size = friend count. Hovering lights up a user's
// neighbourhood; the legend lists each community with its best-connected
// member so the clusters have names. Best for seeing *which groups* HighScore
// has grown into and how (or whether) they connect.

import type { AdminGraphNode } from "@workshop/shared";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import random from "graphology-layout/random";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { useEffect, useMemo, useRef, useState } from "react";
import Sigma from "sigma";
import {
  CanvasButton,
  canvasFrame,
  LegendRow,
  overlayBottom,
  overlayGroup,
  overlayTop,
} from "./canvasControls";
import { displayName, type GraphViewProps } from "./model";

interface Community {
  id: number;
  color: string;
  members: AdminGraphNode[];
  /** Highest-degree member, the cluster's "anchor". */
  anchor: AdminGraphNode;
}

/** Deterministic PRNG so communities and the initial layout are stable across renders. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function ClusterGraphView({
  data,
  selectedId,
  onSelect,
  focus,
  height,
  palette,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [hideIsolated, setHideIsolated] = useState(false);

  // Build the graph + communities once per dataset.
  const { graph, communities, communityOf } = useMemo(() => {
    const g = new Graph({ type: "undirected" });
    const nodesById = new Map(data.nodes.map((n) => [n.id, n]));
    for (const n of data.nodes) {
      g.addNode(n.id, {
        label: displayName(n),
        size: 4 + Math.min(16, n.friendCount * 1.1),
        isolated: n.friendCount === 0 ? 1 : 0,
        dim: 0,
        focus: 0,
        hideLabel: 0,
        hidden: 0,
      });
    }
    for (const e of data.edges) {
      if (g.hasNode(e.source) && g.hasNode(e.target) && !g.hasEdge(e.source, e.target)) {
        g.addEdge(e.source, e.target, { lit: 0, dim: 0 });
      }
    }
    const rng = mulberry32(42);
    random.assign(g, { scale: 100, rng });
    if (g.order > 0) {
      const settings = forceAtlas2.inferSettings(g);
      forceAtlas2.assign(g, {
        iterations: 600,
        settings: { ...settings, gravity: 1.2, scalingRatio: 8 },
      });
    }
    const mapping = g.order > 0 ? louvain(g, { rng: mulberry32(7), resolution: 1 }) : {};
    // Renumber communities by size so #1 is the biggest and colours are stable.
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
    const list: Community[] = ordered.map((members, i) => {
      const anchor = [...members].sort(
        (a, b) => b.friendCount - a.friendCount,
      )[0] as AdminGraphNode;
      const color = palette.series[i % palette.series.length] ?? palette.accent;
      for (const m of members) {
        communityOf.set(m.id, i);
        g.setNodeAttribute(m.id, "color", color);
        g.setNodeAttribute(m.id, "community", i);
      }
      return { id: i, color, members, anchor };
    });
    return { graph: g, communities: list, communityOf };
  }, [data, palette]);

  // Mount sigma once per graph. Styling is attribute-driven (sigma v4 style
  // declaration): the focus effect below just rewrites `dim` / `lit` / `focus`
  // attributes and sigma re-renders from the graph change events.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const dimNode = `${palette.border}`;
    const renderer = new Sigma(graph, el, {
      settings: {
        renderLabels: true,
        labelRenderedSizeThreshold: 0,
        labelDensity: 1,
        labelGridCellSize: 60,
        minCameraRatio: 0.1,
        maxCameraRatio: 4,
        enableNodeDrag: false,
        itemSizesReference: "screen",
      },
      styles: {
        nodes: {
          x: { attribute: "x" },
          y: { attribute: "y" },
          size: { attribute: "size", defaultValue: 5 },
          color: (attrs) => (attrs.dim ? dimNode : String(attrs.color ?? palette.accent)),
          label: { attribute: "label", defaultValue: "" },
          labelColor: palette.text,
          labelSize: 12,
          labelFont: "system-ui, sans-serif",
          labelVisibility: (attrs) =>
            attrs.hideLabel ? "hidden" : attrs.focus ? "visible" : attrs.dim ? "hidden" : "auto",
          visibility: (attrs) => (attrs.hidden ? "hidden" : "visible"),
          zIndex: (attrs) => (attrs.focus ? 2 : attrs.dim ? 0 : 1),
          cursor: "pointer",
        },
        edges: {
          size: (attrs) => (attrs.lit ? 2 : 1),
          color: (attrs) =>
            attrs.lit ? palette.accent : attrs.dim ? `${palette.border}55` : palette.border,
        },
      },
    });
    sigmaRef.current = renderer;
    renderer.on("clickNode", ({ node }) => onSelect(node));
    renderer.on("clickStage", () => onSelect(null));
    renderer.on("enterNode", ({ node }) => setHovered(node));
    renderer.on("leaveNode", () => setHovered(null));
    return () => {
      renderer.kill();
      sigmaRef.current = null;
    };
  }, [graph, palette, onSelect]);

  // Focus (hover beats selection) dims everyone outside the neighbourhood.
  useEffect(() => {
    const focus = hovered ?? selectedId;
    const neighbors = focus && graph.hasNode(focus) ? new Set(graph.neighbors(focus)) : null;
    graph.forEachNode((node, attrs) => {
      const inFocus = focus === null || node === focus || Boolean(neighbors?.has(node));
      graph.mergeNodeAttributes(node, {
        dim: focus !== null && !inFocus ? 1 : 0,
        focus: focus !== null && inFocus ? 1 : 0,
        hideLabel: !showLabels ? 1 : 0,
        hidden: hideIsolated && attrs.isolated ? 1 : 0,
      });
    });
    graph.forEachEdge((edge) => {
      const touches = focus !== null && graph.hasExtremity(edge, focus);
      graph.mergeEdgeAttributes(edge, {
        lit: touches ? 1 : 0,
        dim: focus !== null && !touches ? 1 : 0,
      });
    });
    if (selectedId && graph.hasNode(selectedId)) {
      sigmaRef.current?.setNodeState(selectedId, { isHighlighted: true });
    }
  }, [graph, hovered, selectedId, showLabels, hideIsolated]);

  // Locate: fly the camera to the requested user.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run on a new locate request
  useEffect(() => {
    const renderer = sigmaRef.current;
    if (!focus || !renderer || !graph.hasNode(focus.id)) return;
    const pos = renderer.getNodeDisplayData(focus.id);
    if (!pos) return;
    const cam = renderer.getCamera();
    void cam.animate(
      { x: pos.x, y: pos.y, ratio: Math.min(cam.getState().ratio, 0.5) },
      { duration: 400 },
    );
  }, [focus?.nonce]);

  const camera = () => sigmaRef.current?.getCamera();
  const selectedCommunity = selectedId ? communityOf.get(selectedId) : undefined;

  return (
    <div style={canvasFrame(palette, height)} data-testid="admin-graph-clusters">
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div style={overlayTop}>
        <div style={overlayGroup}>
          <CanvasButton
            palette={palette}
            title="Toggle labels"
            active={showLabels}
            onClick={() => setShowLabels((v) => !v)}
          >
            Labels
          </CanvasButton>
          <CanvasButton
            palette={palette}
            title="Hide users with no friends"
            active={hideIsolated}
            onClick={() => setHideIsolated((v) => !v)}
          >
            Hide loners
          </CanvasButton>
        </div>
        <div style={overlayGroup}>
          <CanvasButton
            palette={palette}
            title="Zoom in"
            onClick={() => camera()?.zoomIn({ duration: 200 })}
          >
            +
          </CanvasButton>
          <CanvasButton
            palette={palette}
            title="Zoom out"
            onClick={() => camera()?.zoomOut({ duration: 200 })}
          >
            −
          </CanvasButton>
          <CanvasButton
            palette={palette}
            title="Reset view"
            onClick={() => camera()?.reset({ duration: 300 })}
          >
            ⟲
          </CanvasButton>
        </div>
      </div>
      <div style={overlayBottom(palette)}>
        <LegendRow
          palette={palette}
          items={communities.map((c) => ({
            color: c.color,
            label: `${c.members.length === 1 ? "Solo" : `Group ${c.id + 1}`} · ${c.members.length} · ${displayName(c.anchor)}${selectedCommunity === c.id ? " ◀" : ""}`,
          }))}
        />
        <span style={{ fontSize: 12, color: palette.muted }}>
          {communities.filter((c) => c.members.length > 1).length} friend groups (Louvain) · size =
          friend count · hover to light up a neighbourhood
        </span>
      </div>
    </div>
  );
}
