// Design A on native — "Growth replay" drawn by NativeGraphCanvas. The
// d3-force layout is settled once for the whole graph; the timeline scrubber
// just filters which users and friendships are visible, so replaying growth
// never re-runs physics on the phone.

import type { AdminGraphNode } from "@workshop/shared";
import { Text } from "@workshop/ui";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { boundsOf, runForceLayout } from "./layouts";
import {
  ACTIVITY_BAND_LABEL,
  type ActivityBand,
  activityBand,
  adjacency,
  cohortLabel,
  cohortOf,
  cohorts,
  displayName,
  formatDay,
  type GraphViewProps,
  radiusFor,
  timeDomain,
} from "./model";
import { type CanvasEdge, type CanvasNode, NativeGraphCanvas } from "./NativeGraphCanvas";
import { ChromeButton, ChromeLegend, ChromeTop } from "./nativeChrome";

type ColorMode = "cohort" | "activity";

const BAND_COLORS: Record<ActivityBand, string> = {
  week: "#3DD68C",
  month: "#F5A524",
  dormant: "#94A3B8",
  never: "#55504C",
};
const PLAY_STEPS = 240;

function Slider({
  value,
  min,
  max,
  onChange,
  accent,
  track,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  accent: string;
  track: string;
}) {
  const [width, setWidth] = useState(1);
  const frac = max > min ? (value - min) / (max - min) : 1;
  const toValue = (x: number) => min + Math.min(1, Math.max(0, x / width)) * (max - min);
  const gesture = Gesture.Pan()
    .minDistance(0)
    .runOnJS(true)
    .onBegin((e) => onChange(toValue(e.x)))
    .onUpdate((e) => onChange(toValue(e.x)));
  return (
    <GestureDetector gesture={gesture}>
      <View
        style={styles.sliderHit}
        onLayout={(e) => setWidth(Math.max(1, e.nativeEvent.layout.width))}
        accessibilityRole="adjustable"
        accessibilityLabel="Timeline"
        testID="admin-graph-force-scrubber"
      >
        <View style={[styles.sliderTrack, { backgroundColor: track }]}>
          <View style={[styles.sliderFill, { width: `${frac * 100}%`, backgroundColor: accent }]} />
        </View>
        <View style={[styles.sliderThumb, { left: `${frac * 100}%`, backgroundColor: accent }]} />
      </View>
    </GestureDetector>
  );
}

export function ForceGraphView({
  data,
  selectedId,
  onSelect,
  focus,
  height,
  palette,
}: GraphViewProps) {
  const [width, setWidth] = useState(0);
  const [colorMode, setColorMode] = useState<ColorMode>("cohort");
  const [showLabels, setShowLabels] = useState(true);
  const [fitNonce, setFitNonce] = useState(0);
  const domain = useMemo(() => timeDomain(data), [data]);
  const [t, setT] = useState(domain.end);
  const [playing, setPlaying] = useState(false);
  const now = useMemo(() => new Date(), []);

  const positions = useMemo(() => runForceLayout(data), [data]);
  const bounds = useMemo(() => boundsOf(positions, 30), [positions]);
  const cohortList = useMemo(() => cohorts(data.nodes), [data.nodes]);
  const adj = useMemo(() => adjacency(data.edges), [data.edges]);
  const cohortColor = (c: string) =>
    palette.series[cohortList.indexOf(c) % palette.series.length] ?? palette.accent;
  const fillFor = (n: AdminGraphNode) =>
    colorMode === "cohort" ? cohortColor(cohortOf(n)) : BAND_COLORS[activityBand(n, now)];

  useEffect(() => {
    if (!playing) return;
    const step = (domain.end - domain.start) / PLAY_STEPS || 1;
    const id = setInterval(() => {
      setT((prev) => {
        const next = prev + step;
        if (next >= domain.end) {
          setPlaying(false);
          return domain.end;
        }
        return next;
      });
    }, 40);
    return () => clearInterval(id);
  }, [playing, domain]);

  const cutoff = new Date(t).toISOString();
  const neighbors = selectedId ? adj.get(selectedId) : undefined;
  const dim = (id: string) => selectedId !== null && id !== selectedId && !neighbors?.has(id);

  const visible = data.nodes.filter((n) => n.createdAt <= cutoff);
  const visibleIds = new Set(visible.map((n) => n.id));
  const nodes: CanvasNode[] = visible.map((n) => {
    const p = positions.get(n.id) ?? { x: 0, y: 0 };
    return {
      id: n.id,
      x: p.x,
      y: p.y,
      r: radiusFor(n),
      color: fillFor(n),
      label: displayName(n),
      avatarVersion: n.avatarVersion,
      isAdmin: n.isAdmin,
      dim: dim(n.id),
    };
  });
  const edges: CanvasEdge[] = data.edges
    .filter((e) => e.createdAt <= cutoff && visibleIds.has(e.source) && visibleIds.has(e.target))
    .map((e) => {
      const a = positions.get(e.source) ?? { x: 0, y: 0 };
      const b = positions.get(e.target) ?? { x: 0, y: 0 };
      const lit = selectedId !== null && (e.source === selectedId || e.target === selectedId);
      return {
        key: `${e.source}|${e.target}`,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        color: lit ? palette.accent : palette.border,
        width: lit ? 2 : 1.2,
        dim: dim(e.source) && dim(e.target),
      };
    });

  const legend =
    colorMode === "cohort"
      ? cohortList.map((c) => ({ color: cohortColor(c), label: cohortLabel(c) }))
      : (Object.keys(BAND_COLORS) as ActivityBand[]).map((b) => ({
          color: BAND_COLORS[b],
          label: ACTIVITY_BAND_LABEL[b],
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
          testID="admin-graph-force"
        >
          <ChromeTop>
            <ChromeButton
              label="Cohort"
              active={colorMode === "cohort"}
              onPress={() => setColorMode("cohort")}
              palette={palette}
            />
            <ChromeButton
              label="Activity"
              active={colorMode === "activity"}
              onPress={() => setColorMode("activity")}
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
          <View
            style={[
              styles.bottom,
              { backgroundColor: `${palette.surface}E6`, borderColor: palette.border },
            ]}
          >
            <View style={styles.timelineRow}>
              <Pressable
                onPress={() => {
                  if (playing) setPlaying(false);
                  else {
                    if (t >= domain.end) setT(domain.start);
                    setPlaying(true);
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={playing ? "Pause replay" : "Replay growth"}
                style={[
                  styles.play,
                  { borderColor: palette.border, backgroundColor: palette.surface },
                ]}
              >
                <Text style={{ color: palette.text }}>{playing ? "❚❚" : "▶"}</Text>
              </Pressable>
              <Slider
                value={t}
                min={domain.start}
                max={domain.end}
                onChange={(v) => {
                  setPlaying(false);
                  setT(v);
                }}
                accent={palette.accent}
                track={palette.border}
              />
            </View>
            <Text variant="caption" style={{ color: palette.text }}>
              {formatDay(t)} · {nodes.length} users · {edges.length} friendships
            </Text>
            <ChromeLegend items={legend} palette={palette} />
          </View>
        </NativeGraphCanvas>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bottom: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 8,
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  timelineRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  play: {
    width: 34,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sliderHit: { flex: 1, height: 30, justifyContent: "center" },
  sliderTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  sliderFill: { height: 4 },
  sliderThumb: { position: "absolute", width: 18, height: 18, borderRadius: 9, marginLeft: -9 },
});
