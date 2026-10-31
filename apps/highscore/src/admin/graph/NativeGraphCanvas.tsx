// The native renderer behind the three graph designs on iOS. No SVG, no
// WebGL: nodes are absolutely-positioned Pressables, edges are thin rotated
// Views, and the whole scene sits in a pan + pinch gesture (react-native-
// gesture-handler + reanimated). Layouts are computed up front by
// `layouts.ts`; this component only draws and moves the camera.

import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { Text } from "@workshop/ui";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { type Bounds, fitTransform } from "./layouts";
import type { GraphPalette } from "./model";

export interface CanvasNode {
  id: string;
  x: number;
  y: number;
  r: number;
  color: string;
  label: string;
  avatarVersion: string | null;
  isAdmin: boolean;
  dim: boolean;
}

export interface CanvasEdge {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  dim: boolean;
  dashed?: boolean;
}

interface Props {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  width: number;
  height: number;
  bounds: Bounds;
  palette: GraphPalette;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Pan/zoom to a node; `nonce` changes per request. */
  focus?: { id: string; nonce: number } | null;
  /** Bumps to re-fit the scene (e.g. a layout switch). */
  fitNonce?: number;
  showLabels: boolean;
  /** Height of the controls (top) and legend/timeline (bottom) floated over
   *  the scene; fit and locate frame the graph in the space between them. */
  chromeInsets?: { top: number; bottom: number };
  /** Rendered above the scene (controls, legend). */
  children?: ReactNode;
  testID?: string;
}

const MIN_SCALE = 0.15;
const LABEL_WIDTH = 120;
const MAX_SCALE = 5;

export function NativeGraphCanvas({
  nodes,
  edges,
  width,
  height,
  bounds,
  palette,
  selectedId,
  onSelect,
  focus,
  fitNonce = 0,
  showLabels,
  chromeInsets = { top: 44, bottom: 80 },
  children,
  testID,
}: Props) {
  const viewTop = chromeInsets.top;
  const viewHeight = Math.max(1, height - chromeInsets.top - chromeInsets.bottom);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Fit on mount / layout change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fit only when the scene or viewport changes
  useEffect(() => {
    if (width <= 0 || height <= 0) return;
    const t = fitTransform(bounds, width, viewHeight, 24);
    tx.value = withTiming(t.x, { duration: 300 });
    ty.value = withTiming(viewTop + t.y, { duration: 300 });
    scale.value = withTiming(t.k, { duration: 300 });
  }, [bounds, width, height, viewTop, viewHeight, fitNonce]);

  // Locate a user. Each request is handled once, as soon as its node is
  // drawn: a view that filtered the target out (timeline, hide loners)
  // reveals it first, and the camera moves on that render.
  const handledFocus = useRef<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check a pending request when the drawn nodes change
  useEffect(() => {
    if (!focus || handledFocus.current === focus.nonce) return;
    const n = nodeById.get(focus.id);
    if (!n) return;
    handledFocus.current = focus.nonce;
    const k = Math.max(1.4, scale.value);
    tx.value = withTiming(width / 2 - n.x * k, { duration: 350 });
    ty.value = withTiming(viewTop + viewHeight / 2 - n.y * k, { duration: 350 });
    scale.value = withTiming(k, { duration: 350 });
  }, [focus?.nonce, nodeById]);

  // Both gestures apply their per-frame deltas to the live camera instead of
  // replaying from a start snapshot, so a pan that becomes a pinch (or the
  // reverse) composes without either one resetting the other's progress.
  const pan = Gesture.Pan()
    .minDistance(4)
    .onChange((e) => {
      tx.value += e.changeX;
      ty.value += e.changeY;
    });
  const pinch = Gesture.Pinch().onChange((e) => {
    const prev = scale.value;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * e.scaleChange));
    const ratio = next / prev;
    // Zoom around the pinch focal point.
    tx.value = e.focalX - (e.focalX - tx.value) * ratio;
    ty.value = e.focalY - (e.focalY - ty.value) * ratio;
    scale.value = next;
  });
  const gesture = Gesture.Simultaneous(pan, pinch);

  // The scene is viewport-sized (so its children stay inside a real frame
  // for accessibility and hit-testing) and RN scales about a view's centre,
  // so convert the origin-based camera (x' = k·x + t) into RN's transform.
  const sceneStyle = useAnimatedStyle(() => {
    const k = scale.value;
    return {
      transform: [
        { translateX: tx.value - (width / 2) * (1 - k) },
        { translateY: ty.value - (height / 2) * (1 - k) },
        { scale: k },
      ],
    };
  });

  return (
    <View
      style={[
        styles.frame,
        { width, height, backgroundColor: palette.canvas, borderColor: palette.border },
      ]}
      testID={testID}
    >
      <GestureDetector gesture={gesture}>
        {/* A plain View, not a Pressable: a Pressable is one accessibility
            element and would hide every node from VoiceOver and test tooling. */}
        <View style={styles.stage} accessible={false} accessibilityLabel="Graph">
          <Animated.View
            style={[styles.scene, { width, height }, sceneStyle]}
            pointerEvents="box-none"
          >
            {edges.map((e) => {
              const dx = e.x2 - e.x1;
              const dy = e.y2 - e.y1;
              const len = Math.hypot(dx, dy);
              const angle = Math.atan2(dy, dx);
              return (
                <View
                  key={e.key}
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: (e.x1 + e.x2) / 2 - len / 2,
                    top: (e.y1 + e.y2) / 2 - e.width / 2,
                    width: len,
                    height: e.width,
                    backgroundColor: e.dashed ? "transparent" : e.color,
                    borderTopWidth: e.dashed ? e.width : 0,
                    borderColor: e.color,
                    borderStyle: e.dashed ? "dashed" : "solid",
                    opacity: e.dim ? 0.15 : 0.8,
                    transform: [{ rotate: `${angle}rad` }],
                  }}
                />
              );
            })}
            {nodes.map((n) => {
              const selected = n.id === selectedId;
              const img = userAvatarImageUrl(n.id, n.avatarVersion);
              const size = n.r * 2;
              return (
                <Pressable
                  key={n.id}
                  onPress={() => onSelect(selected ? null : n.id)}
                  accessibilityRole="button"
                  accessibilityLabel={n.label}
                  testID={`admin-graph-node-${n.id}`}
                  hitSlop={6}
                  style={{
                    position: "absolute",
                    left: n.x - n.r,
                    top: n.y - n.r,
                    width: size,
                    alignItems: "center",
                    opacity: n.dim ? 0.25 : 1,
                  }}
                >
                  <View
                    style={{
                      width: size,
                      height: size,
                      borderRadius: n.r,
                      backgroundColor: n.color,
                      borderWidth: selected ? 3 : 1.5,
                      borderColor: selected ? palette.accent : palette.canvas,
                      overflow: "hidden",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {img ? (
                      <Image
                        source={{ uri: img }}
                        style={{ width: size - 4, height: size - 4, borderRadius: n.r }}
                      />
                    ) : null}
                  </View>
                  {n.isAdmin ? (
                    <Text style={[styles.star, { color: palette.accent }]}>★</Text>
                  ) : null}
                </Pressable>
              );
            })}
            {/* Labels are siblings of the nodes, not children: inside a node
                they were squeezed to the node's width, and a wider label
                would grow the tap target. */}
            {nodes.map((n) =>
              showLabels || n.id === selectedId ? (
                <View
                  key={`label-${n.id}`}
                  pointerEvents="none"
                  style={[
                    styles.labelWrap,
                    { left: n.x - LABEL_WIDTH / 2, top: n.y + n.r + 2, opacity: n.dim ? 0.25 : 1 },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.label,
                      { color: palette.text, backgroundColor: `${palette.canvas}CC` },
                    ]}
                  >
                    {n.label}
                  </Text>
                </View>
              ) : null,
            )}
          </Animated.View>
        </View>
      </GestureDetector>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  stage: { flex: 1 },
  scene: { position: "absolute", left: 0, top: 0 },
  labelWrap: { position: "absolute", width: LABEL_WIDTH, alignItems: "center" },
  label: {
    fontSize: 10,
    paddingHorizontal: 3,
    borderRadius: 3,
    maxWidth: LABEL_WIDTH,
    overflow: "hidden",
  },
  star: { position: "absolute", top: -12, fontSize: 10 },
});
