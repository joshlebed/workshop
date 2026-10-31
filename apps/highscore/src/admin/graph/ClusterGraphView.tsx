// Design B on native — "Friend groups": ForceAtlas2 positions + Louvain
// communities from layouts.ts, drawn by NativeGraphCanvas. Tap a node to
// light up its neighbourhood (no hover on a phone).

import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { boundsOf, runCommunityLayout } from "./layouts";
import { adjacency, displayName, type GraphViewProps } from "./model";
import { type CanvasEdge, type CanvasNode, NativeGraphCanvas } from "./NativeGraphCanvas";
import { ChromeButton, ChromeLegend, ChromeTop } from "./nativeChrome";

export function ClusterGraphView({
  data,
  selectedId,
  onSelect,
  focus,
  height,
  palette,
}: GraphViewProps) {
  const [width, setWidth] = useState(0);
  const [showLabels, setShowLabels] = useState(true);
  const [hideIsolated, setHideIsolated] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);

  const layout = useMemo(() => runCommunityLayout(data), [data]);
  const bounds = useMemo(() => boundsOf(layout.positions, 20), [layout]);
  const adj = useMemo(() => adjacency(data.edges), [data.edges]);
  const colorOf = (community: number) =>
    palette.series[community % palette.series.length] ?? palette.accent;

  const neighbors = selectedId ? adj.get(selectedId) : undefined;
  const dim = (id: string) => selectedId !== null && id !== selectedId && !neighbors?.has(id);

  // Locating a loner while loners are hidden shows them again so the canvas
  // can draw (and pan to) the target.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on a new locate request
  useEffect(() => {
    if (!focus || !hideIsolated) return;
    if (data.nodes.some((n) => n.id === focus.id && n.friendCount === 0)) setHideIsolated(false);
  }, [focus?.nonce]);

  const shown = hideIsolated ? data.nodes.filter((n) => n.friendCount > 0) : data.nodes;
  const nodes: CanvasNode[] = shown.map((n) => {
    const p = layout.positions.get(n.id) ?? { x: 0, y: 0 };
    return {
      id: n.id,
      x: p.x,
      y: p.y,
      r: 5 + Math.min(16, n.friendCount * 1.1),
      color: colorOf(layout.communityOf.get(n.id) ?? 0),
      label: displayName(n),
      avatarVersion: n.avatarVersion,
      isAdmin: n.isAdmin,
      dim: dim(n.id),
    };
  });
  const edges: CanvasEdge[] = data.edges.map((e) => {
    const a = layout.positions.get(e.source) ?? { x: 0, y: 0 };
    const b = layout.positions.get(e.target) ?? { x: 0, y: 0 };
    const lit = selectedId !== null && (e.source === selectedId || e.target === selectedId);
    return {
      key: `${e.source}|${e.target}`,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      color: lit ? palette.accent : palette.border,
      width: lit ? 2 : 1,
      dim: selectedId !== null && !lit,
    };
  });
  const selectedCommunity = selectedId ? layout.communityOf.get(selectedId) : undefined;

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
          testID="admin-graph-clusters"
        >
          <ChromeTop>
            <ChromeButton
              label="Labels"
              active={showLabels}
              onPress={() => setShowLabels((v) => !v)}
              palette={palette}
            />
            <ChromeButton
              label="Hide loners"
              active={hideIsolated}
              onPress={() => setHideIsolated((v) => !v)}
              palette={palette}
            />
            <ChromeButton label="Fit" onPress={() => setFitNonce((n) => n + 1)} palette={palette} />
          </ChromeTop>
          <ChromeLegend
            palette={palette}
            items={layout.communities.map((c) => ({
              color: colorOf(c.id),
              label: `${c.members.length === 1 ? "Solo" : `Group ${c.id + 1}`} · ${c.members.length} · ${displayName(c.anchor)}${selectedCommunity === c.id ? " ◀" : ""}`,
            }))}
            note={`${layout.communities.filter((c) => c.members.length > 1).length} friend groups (Louvain) · size = friend count · tap a user to light up their neighbourhood`}
          />
        </NativeGraphCanvas>
      ) : null}
    </View>
  );
}
