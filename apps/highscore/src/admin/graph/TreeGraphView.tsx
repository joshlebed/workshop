// Design C on native — "Invite tree": the inferred who-brought-whom forest on
// a radial layout (layouts.ts), drawn by NativeGraphCanvas. Tree edges are
// solid, other friendships dashed; selecting a user lights their lineage up
// to the seed.

import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { boundsOf, runRadialTreeLayout } from "./layouts";
import { displayName, edgeKey, type GraphViewProps, inferInviteTree, radiusFor } from "./model";
import { type CanvasEdge, type CanvasNode, NativeGraphCanvas } from "./NativeGraphCanvas";
import { ChromeButton, ChromeLegend, ChromeTop } from "./nativeChrome";

export function TreeGraphView({
  data,
  selectedId,
  onSelect,
  focus,
  height,
  palette,
}: GraphViewProps) {
  const [width, setWidth] = useState(0);
  const [showAllEdges, setShowAllEdges] = useState(true);
  const [hideIsolated, setHideIsolated] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [fitNonce, setFitNonce] = useState(0);

  const tree = useMemo(() => inferInviteTree(data), [data]);
  const positions = useMemo(() => runRadialTreeLayout(data, tree), [data, tree]);
  const bounds = useMemo(() => boundsOf(positions, 30), [positions]);
  const maxDepth = useMemo(() => Math.max(0, ...tree.depth.values()), [tree]);
  const genColor = (d: number) => palette.series[d % palette.series.length] ?? palette.accent;

  // Lineage: the selected user plus every ancestor up to the seed.
  const lineage = useMemo(() => {
    const ids = new Set<string>();
    let cur = selectedId;
    while (cur) {
      ids.add(cur);
      cur = tree.parent.get(cur) ?? null;
    }
    return ids;
  }, [selectedId, tree]);
  const keep = useMemo(() => {
    if (!selectedId) return null;
    const s = new Set(lineage);
    for (const e of data.edges) {
      if (e.source === selectedId) s.add(e.target);
      if (e.target === selectedId) s.add(e.source);
    }
    return s;
  }, [selectedId, lineage, data.edges]);

  // Locating a loner while loners are hidden shows them again so the canvas
  // can draw (and pan to) the target.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on a new locate request
  useEffect(() => {
    if (!focus || !hideIsolated) return;
    if (data.nodes.some((n) => n.id === focus.id && n.friendCount === 0)) setHideIsolated(false);
  }, [focus?.nonce]);

  const shown = hideIsolated ? data.nodes.filter((n) => n.friendCount > 0) : data.nodes;
  const shownIds = new Set(shown.map((n) => n.id));
  const nodes: CanvasNode[] = shown.map((n) => {
    const p = positions.get(n.id) ?? { x: 0, y: 0 };
    return {
      id: n.id,
      x: p.x,
      y: p.y,
      r: radiusFor(n, 7, 22),
      color: genColor(tree.depth.get(n.id) ?? 0),
      label: displayName(n),
      avatarVersion: n.avatarVersion,
      isAdmin: n.isAdmin,
      dim: keep !== null && !keep.has(n.id),
    };
  });
  const edges: CanvasEdge[] = data.edges
    .filter((e) => shownIds.has(e.source) && shownIds.has(e.target))
    .filter((e) => showAllEdges || tree.treeEdgeKeys.has(edgeKey(e)))
    .map((e) => {
      const a = positions.get(e.source) ?? { x: 0, y: 0 };
      const b = positions.get(e.target) ?? { x: 0, y: 0 };
      const isTree = tree.treeEdgeKeys.has(edgeKey(e));
      const inLineage =
        isTree &&
        lineage.has(e.source) &&
        lineage.has(e.target) &&
        (tree.parent.get(e.source) === e.target || tree.parent.get(e.target) === e.source);
      const touches = selectedId !== null && (e.source === selectedId || e.target === selectedId);
      return {
        key: `${e.source}|${e.target}`,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        color: inLineage || touches ? palette.accent : isTree ? palette.muted : palette.border,
        width: inLineage || touches ? 2.5 : isTree ? 1.8 : 1,
        dim: selectedId !== null && !inLineage && !touches,
        dashed: !isTree,
      };
    });

  const generations = Array.from({ length: maxDepth + 1 }, (_, d) => ({
    color: genColor(d),
    label: `Gen ${d}${d === 0 ? " (seeds)" : ""} · ${[...tree.depth.values()].filter((x) => x === d).length}`,
  }));

  return (
    <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <NativeGraphCanvas
          nodes={nodes}
          edges={edges}
          width={width}
          height={height}
          bounds={bounds}
          palette={palette}
          selectedId={selectedId}
          onSelect={onSelect}
          focus={focus}
          fitNonce={fitNonce}
          showLabels={showLabels}
          testID="admin-graph-tree"
        >
          <ChromeTop>
            <ChromeButton
              label="All friendships"
              active={showAllEdges}
              onPress={() => setShowAllEdges((v) => !v)}
              palette={palette}
            />
            <ChromeButton
              label="Hide loners"
              active={hideIsolated}
              onPress={() => setHideIsolated((v) => !v)}
              palette={palette}
            />
            <ChromeButton
              label="Labels"
              active={showLabels}
              onPress={() => setShowLabels((v) => !v)}
              palette={palette}
            />
            <ChromeButton label="Fit" onPress={() => setFitNonce((n) => n + 1)} palette={palette} />
          </ChromeTop>
          <ChromeLegend
            palette={palette}
            items={[
              ...generations,
              { color: palette.muted, label: "brought in", shape: "line" },
              { color: palette.border, label: "other friendship", shape: "dashed" },
            ]}
            note={`Parent = the older account in a user's earliest friendship. ${tree.roots.length} seeds · ${data.nodes.length - tree.roots.length} brought in by someone.`}
          />
        </NativeGraphCanvas>
      ) : null}
    </View>
  );
}
