// The native renderer behind the three graph designs on iOS. No SVG, no
// WebGL: nodes are absolutely-positioned Pressables, edges are thin rotated
// Views, and the whole scene sits in a pan + pinch gesture (react-native-
// gesture-handler + reanimated). Layouts are computed up front by
// `layouts.ts`; this component only draws and moves the camera.

import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { Text } from "@workshop/ui";
import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";
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
  children,
  testID,
}: Props) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startScale = useSharedValue(1);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Fit on mount / layout change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fit only when the scene or viewport changes
  useEffect(() => {
    if (width <= 0 || height <= 0) return;
    const t = fitTransform(bounds, width, height, 32);
    tx.value = withTiming(t.x, { duration: 300 });
    ty.value = withTiming(t.y, { duration: 300 });
    scale.value = withTiming(t.k, { duration: 300 });
  }, [bounds, width, height, fitNonce]);

  // Locate a user.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run on a new locate request
  useEffect(() => {
    if (!focus) return;
    const n = nodeById.get(focus.id);
    if (!n) return;
    const k = Math.max(1.4, scale.value);
    tx.value = withTiming(width / 2 - n.x * k, { duration: 350 });
    ty.value = withTiming(height / 2 - n.y * k, { duration: 350 });
    scale.value = withTiming(k, { duration: 350 });
  }, [focus?.nonce]);

  const pan = Gesture.Pan()
    .minDistance(4)
    .onStart(() => {
      startX.value = tx.value;
      startY.value = ty.value;
    })
    .onUpdate((e) => {
      tx.value = startX.value + e.translationX;
      ty.value = startY.value + e.translationY;
    });
  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
      startX.value = tx.value;
      startY.value = ty.value;
    })
    .onUpdate((e) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, startScale.value * e.scale));
      const ratio = next / startScale.value;
      // Zoom around the pinch focal point.
      tx.value = e.focalX - (e.focalX - startX.value) * ratio;
      ty.value = e.focalY - (e.focalY - startY.value) * ratio;
      scale.value = next;
    });
  const gesture = Gesture.Simultaneous(pan, pinch);

  const sceneStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

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
          <Animated.View style={[styles.scene, sceneStyle]} pointerEvents="box-none">
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
                  {showLabels || selected ? (
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.label,
                        { color: palette.text, backgroundColor: `${palette.canvas}CC` },
                      ]}
                    >
                      {n.label}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
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
  scene: { position: "absolute", left: 0, top: 0, width: 1, height: 1 },
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
