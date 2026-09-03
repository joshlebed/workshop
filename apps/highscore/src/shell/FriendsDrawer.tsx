// Friends slide over the ledger instead of replacing it. The drawer is one
// overlay with two panels on a horizontal track: the friends list, and a
// friend's profile pushed in from the right. Both are real URLs (`/friends`,
// `/friends/:userId`) — the router history is what moves, not a screen.
//
// Gestures: swipe in from the right edge to open (threshold commit), drag the
// panel right to dismiss (tracks your finger, then hands the remaining
// distance to the timing curve). Both have a visible tap equivalent — the
// header avatar stack opens it, the panel's own close control shuts it — so
// web and assistive tech never depend on a gesture.

import { type ReactNode, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { tokens } from "../theme";

const OPEN = { duration: 150, easing: Easing.out(Easing.quad) } as const;
const CLOSE = { duration: 120, easing: Easing.out(Easing.quad) } as const;
const EDGE_W = 22;
const COMMIT_RATIO = 0.32;
const COMMIT_VELOCITY = 550;

export interface FriendsDrawerProps {
  open: boolean;
  /** 0 = friends list, 1 = a friend's profile. */
  panel: 0 | 1;
  onOpen: () => void;
  onClose: () => void;
  onBack: () => void;
  listPanel: ReactNode;
  friendPanel: ReactNode;
}

export function FriendsDrawer({
  open,
  panel,
  onOpen,
  onClose,
  onBack,
  listPanel,
  friendPanel,
}: FriendsDrawerProps) {
  const [rendered, setRendered] = useState(open);
  const [width, setWidth] = useState(320);
  const openness = useSharedValue(open ? 1 : 0);
  const drag = useSharedValue(0);
  const track = useSharedValue(panel);

  useEffect(() => {
    if (open) {
      setRendered(true);
      drag.value = 0;
      openness.value = withTiming(1, OPEN);
      return;
    }
    openness.value = withTiming(0, CLOSE, (finished) => {
      if (finished) runOnJS(setRendered)(false);
    });
  }, [open, openness, drag]);

  useEffect(() => {
    track.value = withTiming(panel, OPEN);
  }, [panel, track]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: width * (1 - openness.value) + drag.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: openness.value * 0.72 * (1 - drag.value / width),
  }));
  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -track.value * width }],
  }));

  const commit = panel === 1 ? onBack : onClose;

  const dismissGesture = Gesture.Pan()
    .activeOffsetX([-24, 12])
    .onChange((e) => {
      drag.value = Math.max(0, Math.min(width, drag.value + e.changeX));
    })
    .onEnd((e) => {
      if (drag.value > width * COMMIT_RATIO || e.velocityX > COMMIT_VELOCITY) {
        // Fold the drag distance into `openness` so the exit timing continues
        // from exactly where the finger left off instead of snapping.
        openness.value = 1 - drag.value / width;
        drag.value = 0;
        runOnJS(commit)();
      } else {
        drag.value = withTiming(0, OPEN);
      }
    });

  const edgeGesture = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .onEnd((e) => {
      if (e.translationX < -40 || e.velocityX < -COMMIT_VELOCITY) runOnJS(onOpen)();
    });

  return (
    <>
      {!open ? (
        <GestureDetector gesture={edgeGesture}>
          <View style={styles.edge} testID="friends-edge-swipe" />
        </GestureDetector>
      ) : null}
      {rendered ? (
        <View
          style={StyleSheet.absoluteFill}
          pointerEvents={open ? "auto" : "none"}
          onLayout={(e) => setWidth(Math.min(400, e.nativeEvent.layout.width * 0.88))}
        >
          <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents="none" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close friends"
            onPress={onClose}
            style={StyleSheet.absoluteFill}
            testID="friends-drawer-backdrop"
          />
          <GestureDetector gesture={dismissGesture}>
            <Animated.View style={[styles.panel, { width }, panelStyle]} testID="friends-drawer">
              <Animated.View style={[styles.track, { width: width * 2 }, trackStyle]}>
                <View style={{ width }}>{listPanel}</View>
                <View style={{ width }}>{friendPanel}</View>
              </Animated.View>
            </Animated.View>
          </GestureDetector>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  edge: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: EDGE_W,
  },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "#000" },
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: tokens.bg.surface,
    borderLeftWidth: tokens.bezel,
    borderLeftColor: tokens.border.default,
    overflow: "hidden",
  },
  track: { flexDirection: "row", flex: 1 },
});
