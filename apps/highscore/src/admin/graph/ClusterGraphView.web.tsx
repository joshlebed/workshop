// Design B — "Communities": a sigma.js WebGL canvas over a graphology graph.
// ForceAtlas2 settles the layout, Louvain community detection colours each
// friend group, node size = friend count. Hovering lights up a user's
// neighbourhood; the legend lists each community with its best-connected
// member so the clusters have names. Best for seeing *which groups* HighScore
// has grown into and how (or whether) they connect.

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
import { runCommunityLayout } from "./layouts";
import { displayName, type GraphViewProps } from "./model";

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

  // Layout + communities once per dataset; sigma reads the graph's attributes.
  const { graph, communities, communityOf } = useMemo(() => {
    const layout = runCommunityLayout(data);
    for (const n of data.nodes) {
      const c = layout.communityOf.get(n.id) ?? 0;
      layout.graph.mergeNodeAttributes(n.id, {
        label: displayName(n),
        color: palette.series[c % palette.series.length] ?? palette.accent,
        dim: 0,
        focus: 0,
        hideLabel: 0,
        hidden: 0,
      });
    }
    layout.graph.forEachEdge((edge) => layout.graph.mergeEdgeAttributes(edge, { lit: 0, dim: 0 }));
    return layout;
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
            color: palette.series[c.id % palette.series.length] ?? palette.accent,
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
