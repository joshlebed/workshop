// Design C — "Invite tree": cytoscape.js draws the inferred who-brought-whom
// forest as concentric generations (seeds in the middle, each ring one hop
// further out). Tree edges are solid arrows; the remaining friendships are
// faint dashed arcs you can toggle. Node colour = generation, size = scores,
// avatars where the user has one. Best for reading the *growth story*: which
// seeds compounded and where chains stopped.

import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CanvasButton,
  canvasFrame,
  LegendRow,
  overlayBottom,
  overlayGroup,
  overlayTop,
} from "./canvasControls";
import { displayName, edgeKey, type GraphViewProps, inferInviteTree, radiusFor } from "./model";

type LayoutName = "breadthfirst" | "cose";

export function TreeGraphView({
  data,
  selectedId,
  onSelect,
  focus,
  height,
  palette,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [showAllEdges, setShowAllEdges] = useState(true);
  const [hideIsolated, setHideIsolated] = useState(false);
  const [layoutName, setLayoutName] = useState<LayoutName>("breadthfirst");

  const tree = useMemo(() => inferInviteTree(data), [data]);
  const maxDepth = useMemo(() => Math.max(0, ...tree.depth.values()), [tree]);
  const genColor = useCallback(
    (d: number) => palette.series[d % palette.series.length] ?? palette.accent,
    [palette],
  );

  const elements = useMemo<ElementDefinition[]>(() => {
    const nodes: ElementDefinition[] = data.nodes.map((n) => {
      const depth = tree.depth.get(n.id) ?? 0;
      const img = userAvatarImageUrl(n.id, n.avatarVersion);
      return {
        data: {
          id: n.id,
          label: displayName(n) + (n.isAdmin ? " ★" : ""),
          size: radiusFor(n, 14, 44),
          color: genColor(depth),
          depth,
          img: img ?? "none",
          isolated: n.friendCount === 0 ? 1 : 0,
        },
      };
    });
    const edges: ElementDefinition[] = data.edges.map((e) => {
      const isTree = tree.treeEdgeKeys.has(edgeKey(e));
      // Tree edges point parent → child; the parent is whichever side the child names.
      const parentIsSource = tree.parent.get(e.target) === e.source;
      return {
        data: {
          id: `e-${e.source}-${e.target}`,
          source: isTree ? (parentIsSource ? e.source : e.target) : e.source,
          target: isTree ? (parentIsSource ? e.target : e.source) : e.target,
          tree: isTree ? 1 : 0,
        },
      };
    });
    return [...nodes, ...edges];
  }, [data, tree, genColor]);

  const runLayout = useCallback((cy: Core, name: LayoutName) => {
    const layout =
      name === "breadthfirst"
        ? cy.layout({
            name: "concentric",
            // Seeds in the middle, each generation one ring further out;
            // better-connected users sit toward the inner edge of their ring.
            concentric: (node: cytoscape.NodeSingular) =>
              1000 - Number(node.data("depth") ?? 0) * 10 + Math.min(9, node.degree(false)),
            levelWidth: () => 10,
            minNodeSpacing: 34,
            padding: 40,
            avoidOverlap: true,
            animate: true,
            animationDuration: 400,
          } as cytoscape.LayoutOptions)
        : cy.layout({
            name: "cose",
            animate: "end",
            animationDuration: 400,
            padding: 40,
            nodeRepulsion: () => 12_000,
            idealEdgeLength: () => 70,
          } as cytoscape.LayoutOptions);
    layout.run();
  }, []);

  // Mount cytoscape once per element set; the first layout runs here, later
  // layout switches re-run on the live instance below.
  const layoutRef = useRef(layoutName);
  layoutRef.current = layoutName;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const cy = cytoscape({
      container: el,
      elements,
      minZoom: 0.2,
      maxZoom: 4,
      wheelSensitivity: 0.3,
      style: [
        {
          selector: "node",
          style: {
            width: "data(size)",
            height: "data(size)",
            "background-color": "data(color)",
            "border-width": 2,
            "border-color": "data(color)",
            label: "data(label)",
            color: palette.text,
            "font-size": 10,
            "font-family": "system-ui, sans-serif",
            "text-valign": "bottom",
            "text-margin-y": 5,
            "text-outline-color": palette.canvas,
            "text-outline-width": 2,
            "min-zoomed-font-size": 7,
          },
        },
        {
          selector: "node[img != 'none']",
          style: {
            "background-image": "data(img)",
            "background-fit": "cover",
            "background-clip": "node",
          },
        },
        {
          selector: "edge",
          style: {
            width: 1,
            "line-color": palette.border,
            "line-style": "dashed",
            "curve-style": "bezier",
            opacity: 0.6,
          },
        },
        {
          selector: "edge[tree = 1]",
          style: {
            width: 2,
            "line-style": "solid",
            "line-color": palette.muted,
            "target-arrow-shape": "triangle",
            "target-arrow-color": palette.muted,
            "arrow-scale": 0.8,
            opacity: 1,
          },
        },
        { selector: "edge.hiddenEdge, node.hiddenNode", style: { display: "none" } },
        { selector: ".faded", style: { opacity: 0.15 } },
        {
          selector: "node.selected",
          style: { "border-width": 4, "border-color": palette.accent, "z-index": 10 },
        },
        {
          selector: "edge.lit",
          style: {
            "line-color": palette.accent,
            "target-arrow-color": palette.accent,
            width: 3,
            opacity: 1,
          },
        },
        {
          selector: "edge.lineage",
          style: {
            "line-color": palette.accent,
            "target-arrow-color": palette.accent,
            width: 2.5,
            opacity: 1,
          },
        },
      ],
    });
    cyRef.current = cy;
    cy.on("tap", "node", (evt) => onSelect(evt.target.id()));
    cy.on("tap", (evt) => {
      if (evt.target === cy) onSelect(null);
    });
    runLayout(cy, layoutRef.current);
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [elements, palette, onSelect, runLayout]);

  const switchLayout = (name: LayoutName) => {
    setLayoutName(name);
    const cy = cyRef.current;
    if (cy) runLayout(cy, name);
  };

  // Visibility toggles.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.edges("[tree = 0]").toggleClass("hiddenEdge", !showAllEdges);
      cy.nodes("[isolated = 1]").toggleClass("hiddenNode", hideIsolated);
    });
  }, [showAllEdges, hideIsolated]);

  // Selection: light the node, its edges, and the lineage up to the root.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass("selected lit lineage faded");
      if (!selectedId || cy.getElementById(selectedId).empty()) return;
      const node = cy.getElementById(selectedId);
      node.addClass("selected");
      const keep = node.closedNeighborhood();
      node.connectedEdges().addClass("lit");
      let cur: string | null = selectedId;
      const lineage: string[] = [];
      while (cur) {
        const p: string | null = tree.parent.get(cur) ?? null;
        if (p) {
          lineage.push(p);
          cy.getElementById(`e-${p < cur ? p : cur}-${p < cur ? cur : p}`).addClass("lineage");
        }
        cur = p;
      }
      const lineageNodes = cy.nodes().filter((n) => lineage.includes(n.id()));
      cy.elements().not(keep).not(lineageNodes).not(".lineage").addClass("faded");
    });
  }, [selectedId, tree]);

  // Locate: center the requested user.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run on a new locate request
  useEffect(() => {
    const cy = cyRef.current;
    if (!focus || !cy) return;
    const node = cy.getElementById(focus.id);
    if (node.empty()) return;
    cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 1.4), duration: 400 });
  }, [focus?.nonce]);

  const generations = Array.from({ length: maxDepth + 1 }, (_, d) => ({
    color: genColor(d),
    label: `Gen ${d}${d === 0 ? " (seeds)" : ""} · ${[...tree.depth.values()].filter((x) => x === d).length}`,
  }));

  return (
    <div style={canvasFrame(palette, height)} data-testid="admin-graph-tree">
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div style={overlayTop}>
        <div style={overlayGroup}>
          <CanvasButton
            palette={palette}
            title="Concentric generations"
            active={layoutName === "breadthfirst"}
            onClick={() => switchLayout("breadthfirst")}
          >
            Rings
          </CanvasButton>
          <CanvasButton
            palette={palette}
            title="Physics layout"
            active={layoutName === "cose"}
            onClick={() => switchLayout("cose")}
          >
            Physics
          </CanvasButton>
          <CanvasButton
            palette={palette}
            title="Show friendships outside the tree"
            active={showAllEdges}
            onClick={() => setShowAllEdges((v) => !v)}
          >
            All friendships
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
            onClick={() =>
              cyRef.current?.zoom({
                level: (cyRef.current?.zoom() ?? 1) * 1.3,
                renderedPosition: {
                  x: (cyRef.current?.width() ?? 0) / 2,
                  y: (cyRef.current?.height() ?? 0) / 2,
                },
              })
            }
          >
            +
          </CanvasButton>
          <CanvasButton
            palette={palette}
            title="Zoom out"
            onClick={() =>
              cyRef.current?.zoom({
                level: (cyRef.current?.zoom() ?? 1) / 1.3,
                renderedPosition: {
                  x: (cyRef.current?.width() ?? 0) / 2,
                  y: (cyRef.current?.height() ?? 0) / 2,
                },
              })
            }
          >
            −
          </CanvasButton>
          <CanvasButton
            palette={palette}
            title="Fit"
            onClick={() =>
              cyRef.current?.animate({
                fit: { eles: cyRef.current.elements(), padding: 40 },
                duration: 300,
              })
            }
          >
            ⟲
          </CanvasButton>
        </div>
      </div>
      <div style={overlayBottom(palette)}>
        <LegendRow
          palette={palette}
          items={[
            ...generations,
            { color: palette.muted, label: "brought in (arrow → newcomer)", shape: "line" },
            { color: palette.border, label: "other friendship", shape: "dashed" },
          ]}
        />
        <span style={{ fontSize: 12, color: palette.muted }}>
          Parent = the older account in a user's earliest friendship. {tree.roots.length} seeds ·{" "}
          {data.nodes.length - tree.roots.length} brought in by someone.
        </span>
      </div>
    </div>
  );
}
